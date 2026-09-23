use reqwest::{Client, RequestBuilder, Url};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOptions {
    pub auth_mode: Option<String>,
    enable_thinking: Option<bool>,
    max_tokens: Option<u64>,
    // Missing preserves the legacy temperature; explicit null omits it.
    #[serde(default = "legacy_temperature")]
    temperature: Option<f64>,
    token_parameter: Option<String>,
    timeout_seconds: Option<u64>,
}

fn legacy_temperature() -> Option<f64> {
    Some(0.85)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeConfig {
    pub provider_id: Option<String>,
    pub adapter: String,
    pub base_url: String,
    pub model_id: String,
    pub api_key: Option<String>,
    pub request_options: Option<RequestOptions>,
}

fn endpoint(base_url: &str, adapter: &str) -> Result<Url, String> {
    let suffix = match adapter {
        "openai_chat" => "/chat/completions",
        "anthropic_messages" => "/messages",
        "openai_responses" => "/responses",
        _ => return Err("不支持的接口协议".into()),
    };
    let mut url = Url::parse(base_url.trim()).map_err(|_| "请输入有效的 HTTP(S) 接口地址")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("接口地址须为 HTTP(S)，不含账号、查询参数或锚点".into());
    }
    let path = url.path().trim_end_matches('/');
    let explicit = ["/chat/completions", "/messages", "/responses"]
        .iter()
        .any(|ending| path.ends_with(ending));
    let next = if explicit {
        if !path.ends_with(suffix) {
            return Err("接口地址与所选协议不匹配。".into());
        }
        path.to_string()
    } else {
        let versioned = path
            .rsplit('/')
            .next()
            .and_then(|segment| segment.strip_prefix('v'))
            .is_some_and(|version| {
                !version.is_empty() && version.chars().all(|c| c.is_ascii_digit())
            });
        let prefix = if path.is_empty() {
            "/v1".to_string()
        } else if adapter == "anthropic_messages" && !versioned {
            format!("{path}/v1")
        } else {
            path.to_string()
        };
        format!("{prefix}{suffix}")
    };
    url.set_path(&next);
    Ok(url)
}

fn build_request(config: &ProbeConfig, key: Option<&str>) -> Result<RequestBuilder, String> {
    let legacy = RequestOptions {
        temperature: legacy_temperature(),
        ..Default::default()
    };
    let options = config.request_options.as_ref().unwrap_or(&legacy);
    let timeout = options.timeout_seconds.unwrap_or(120);
    let max_tokens = options.max_tokens.unwrap_or(4096);
    if !(5..=600).contains(&timeout)
        || !(1..=1_000_000).contains(&max_tokens)
        || options
            .temperature
            .is_some_and(|value| !value.is_finite() || !(0.0..=2.0).contains(&value))
    {
        return Err("请检查输出 Token、温度或超时设置。".into());
    }
    if config.model_id.trim().is_empty() {
        return Err("请填写模型 ID。".into());
    }
    let url = endpoint(&config.base_url, &config.adapter)?;
    let anthropic = config.adapter == "anthropic_messages";
    let responses = config.adapter == "openai_responses";
    let auth_mode = match options.auth_mode.as_deref().unwrap_or("auto") {
        "auto" => {
            if anthropic {
                "x-api-key"
            } else {
                "bearer"
            }
        }
        mode @ ("bearer" | "x-api-key" | "none") => mode,
        _ => return Err("不支持的鉴权方式。".into()),
    };
    let token_parameter = match options.token_parameter.as_deref().unwrap_or("max_tokens") {
        param @ ("max_tokens" | "max_completion_tokens") => param,
        _ => return Err("不支持的 Token 参数名。".into()),
    };
    let key = key.unwrap_or_default().trim();
    if auth_mode != "none" && key.is_empty() {
        return Err("请先保存 API Key，或选择无需鉴权。".into());
    }
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "HTTP 客户端构建失败")?;
    let mut request = client.post(url);
    if auth_mode == "bearer" {
        request = request.bearer_auth(key);
    }
    if auth_mode == "x-api-key" {
        request = request.header("x-api-key", key);
    }
    if anthropic {
        request = request.header("anthropic-version", "2023-06-01");
    }
    let mut body = json!({ "model": config.model_id.trim(), "stream": false });
    // Keep a modest probe budget while accommodating reasoning-model minimums.
    body[if responses {
        "max_output_tokens"
    } else if anthropic {
        "max_tokens"
    } else {
        token_parameter
    }] = json!(max_tokens.min(1024));
    if let Some(temperature) = options.temperature {
        body["temperature"] = json!(temperature);
    }
    if !anthropic {
        if let Some(enabled) = options.enable_thinking {
            body["enable_thinking"] = json!(enabled);
        }
    }
    if responses {
        body["store"] = json!(false);
        body["instructions"] = json!("Reply briefly.");
        body["input"] = json!([{ "role": "user", "content": "Reply OK." }]);
    } else {
        body["messages"] = json!([{ "role": "user", "content": "Reply OK." }]);
        if anthropic {
            body["system"] = json!("Reply briefly.");
        } else {
            body["messages"] = json!([{ "role": "system", "content": "Reply briefly." }, { "role": "user", "content": "Reply OK." }]);
        }
    }
    Ok(request.json(&body))
}

fn probe_result(adapter: &str, status: u16, body: &str, key: Option<&str>) -> Value {
    let payload = serde_json::from_str::<Value>(body).ok();
    let success = (200..=299).contains(&status);
    let has_shape = payload.as_ref().is_some_and(|p| match adapter {
        "openai_chat" => p["choices"]
            .as_array()
            .is_some_and(|items| !items.is_empty()),
        "anthropic_messages" => p["content"].is_array(),
        "openai_responses" => p["output"].is_array(),
        _ => false,
    });
    let has_error = payload
        .as_ref()
        .is_some_and(|p| (!p["error"].is_null()) || p["status"] == "failed");
    let ok = success && has_shape && !has_error;
    let hint = if ok {
        "连通成功（URL、鉴权与模型已验证）"
    } else if success {
        "响应格式与协议不匹配，或服务商返回错误"
    } else {
        match status {
            401 | 403 => "API Key 无效或无权限",
            404 => "接口地址或模型 ID 不存在，请核对完整请求路径",
            429 => "请求被限流或额度不足，请检查服务商账户",
            300..=399 => "接口返回重定向，请填写最终 API 地址",
            _ => "服务端返回错误",
        }
    };
    let detail = if ok {
        String::new()
    } else {
        let message = payload
            .as_ref()
            .and_then(|p| {
                p["error"]["message"]
                    .as_str()
                    .or_else(|| p["message"].as_str())
            })
            .unwrap_or(if payload.is_none() {
                "响应不是 JSON，请确认地址指向模型 API。"
            } else {
                "请检查接口协议、模型权限和参数设置。"
            });
        let sanitized = match key.filter(|key| !key.is_empty()) {
            Some(key) => message.replace(key, "[redacted]"),
            None => message.to_string(),
        };
        sanitized.chars().take(300).collect()
    };
    json!({ "ok": ok, "status": status, "hint": hint, "detail": detail })
}

pub async fn probe(config: ProbeConfig, key: Option<String>) -> Result<Value, String> {
    let response = build_request(&config, key.as_deref())?
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "请求超时，请检查网络或增加超时秒数。"
            } else {
                "连接失败，请检查接口地址、网络和证书。"
            }
            .to_string()
        })?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|_| "读取模型响应失败。")?;
    Ok(probe_result(&config.adapter, status, &body, key.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_preserve_gateway_paths() {
        for (base, adapter, expected) in [
            (
                "https://example.test/",
                "openai_chat",
                "/v1/chat/completions",
            ),
            (
                "https://example.test/api/paas/v4/",
                "openai_chat",
                "/api/paas/v4/chat/completions",
            ),
            (
                "https://example.test/v1/",
                "anthropic_messages",
                "/v1/messages",
            ),
            (
                "https://example.test/anthropic",
                "anthropic_messages",
                "/anthropic/v1/messages",
            ),
            (
                "https://example.test/proxy/v1/messages/",
                "anthropic_messages",
                "/proxy/v1/messages",
            ),
            (
                "https://example.test/proxy/v1",
                "openai_responses",
                "/proxy/v1/responses",
            ),
        ] {
            assert_eq!(endpoint(base, adapter).unwrap().path(), expected);
        }
        for url in [
            "file:///tmp/model",
            "https://key@example.test",
            "https://example.test?key=secret",
            "https://example.test#hash",
        ] {
            assert!(endpoint(url, "openai_chat").is_err());
        }
        assert!(endpoint("https://example.test", "unknown").is_err());
        assert!(endpoint("https://example.test/v1/messages", "openai_chat").is_err());
    }

    #[test]
    fn probe_contract_uses_selected_auth_and_parameters() {
        for adapter in ["openai_chat", "anthropic_messages", "openai_responses"] {
            let config: ProbeConfig = serde_json::from_value(json!({
                "adapter": adapter, "baseUrl": "https://example.test/v1", "modelId": "custom/model",
                "requestOptions": { "authMode": "bearer", "temperature": null, "tokenParameter": "max_completion_tokens", "maxTokens": 8000 }
            })).unwrap();
            let request = build_request(&config, Some("test-key"))
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(request.headers()["authorization"], "Bearer test-key");
            assert!(!request.headers().contains_key("x-api-key"));
            let body: Value =
                serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
            assert!(body.get("temperature").is_none());
            assert_eq!(body["stream"], false);
            assert_eq!(
                body[match adapter {
                    "openai_chat" => "max_completion_tokens",
                    "openai_responses" => "max_output_tokens",
                    _ => "max_tokens",
                }],
                1024
            );
            assert_eq!(body["model"], "custom/model");
        }
    }

    #[test]
    fn probe_supports_keyless_and_validates_errors() {
        let config: ProbeConfig = serde_json::from_value(json!({ "adapter": "openai_chat", "baseUrl": "http://127.0.0.1:11434/v1", "modelId": "local", "requestOptions": { "authMode": "none" } })).unwrap();
        let request = build_request(&config, None).unwrap().build().unwrap();
        assert!(!request.headers().contains_key("authorization"));
        assert_eq!(
            probe_result("openai_chat", 200, "<html>login</html>", None)["ok"],
            false
        );
        assert_eq!(
            probe_result("openai_chat", 200, r#"{"choices":[{}]}"#, None)["ok"],
            true
        );
        let result = probe_result(
            "openai_chat",
            401,
            r#"{"error":{"message":"invalid secret-key"}}"#,
            Some("secret-key"),
        );
        assert_eq!(result["ok"], false);
        assert!(!result.to_string().contains("secret-key"));
        assert!(!probe_result("openai_chat", 429, "{}", None)["hint"]
            .as_str()
            .unwrap()
            .contains("鉴权已通过"));
    }
}
