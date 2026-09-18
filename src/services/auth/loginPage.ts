import { readFileSync } from "fs";
import path from "path";

// The login/register page lives in web/login.html (copied to dist on build) so
// its HTML/CSS/JS stay out of the TypeScript. It is served inside the client's
// OAuth webview. Two values are injected per request via body data-attributes:
// the OAuth state and the base URL of the client's local callback listener.
const TEMPLATE_PATH = path.join(__dirname, "web", "login.html");

let cachedTemplate: string | null = null;

const escapeHtmlAttribute = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

const template = (): string => {
    if (cachedTemplate === null) {
        cachedTemplate = readFileSync(TEMPLATE_PATH, "utf8");
    }
    return cachedTemplate;
};

export const renderLoginPage = (state: string, callbackBase: string): string =>
    template()
        .replace("__STATE__", escapeHtmlAttribute(state))
        .replace("__CALLBACK_BASE__", escapeHtmlAttribute(callbackBase));
