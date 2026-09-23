export interface RgbColor {
	red: number;
	green: number;
	blue: number;
}

const RGB_PATTERN = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/;

export function parseRgb(color: string): RgbColor {
	const match = color.match(RGB_PATTERN);
	if (!match)
		throw new Error(`Expected an RGB computed style, received ${color}.`);

	return {
		red: Number(match[1]),
		green: Number(match[2]),
		blue: Number(match[3]),
	};
}

function linearChannel(channel: number): number {
	const normalized = channel / 255;
	return normalized <= 0.04045
		? normalized / 12.92
		: ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbColor): number {
	return (
		0.2126 * linearChannel(color.red) +
		0.7152 * linearChannel(color.green) +
		0.0722 * linearChannel(color.blue)
	);
}

export function contrastRatio(foreground: string, background: string): number {
	const foregroundLuminance = relativeLuminance(parseRgb(foreground));
	const backgroundLuminance = relativeLuminance(parseRgb(background));
	const lighter = Math.max(foregroundLuminance, backgroundLuminance);
	const darker = Math.min(foregroundLuminance, backgroundLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}
