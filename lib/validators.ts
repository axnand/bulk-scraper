/**
 * Validates and sanitizes a list of URLs
 * @param rawText Raw text string containing URLs (e.g. from textarea)
 * @returns Object containing valid and invalid URLs
 */
export function parseAndValidateUrls(rawText: string) {
    // Split by whitespace or newlines, filter out empty strings
    const rawUrls = rawText.split(/\s+/).filter((url) => url.trim().length > 0);

    // Remove duplicates
    const uniqueUrls = [...new Set(rawUrls)];

    const valid: string[] = [];
    const invalid: string[] = [];

    // Basic LinkedIn URL regex (can be improved based on specific needs)
    const linkedinRegex = /^https?:\/\/(www\.)?linkedin\.com\/.*$/i;

    for (const url of uniqueUrls) {
        try {
            new URL(url); // Check if valid URL object can be created

            if (linkedinRegex.test(url)) {
                valid.push(url);
            } else {
                invalid.push(url);
            }
        } catch {
            invalid.push(url);
        }
    }

    return { valid, invalid };
}
