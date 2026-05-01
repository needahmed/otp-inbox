// Listens for OTP paste requests from the popup or notification clicks.
// When the user copies a code and has a focused OTP input, auto-fills it.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "AUTOFILL_OTP" && typeof msg.code === "string") {
    autofillCode(msg.code);
  }
});

function autofillCode(code: string): void {
  const input = findOtpInput();
  if (!input) return;

  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  if (nativeInputSetter) {
    nativeInputSetter.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    input.value = code;
  }

  input.focus();
}

function findOtpInput(): HTMLInputElement | null {
  // Prefer the currently focused input
  const active = document.activeElement as HTMLInputElement | null;
  if (active && isOtpInput(active)) return active;

  // Search for common OTP input patterns
  const candidates = document.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"], input[id*="otp"], input[id*="code"], input[placeholder*="code" i], input[placeholder*="otp" i]'
  );

  return candidates[0] ?? null;
}

function isOtpInput(el: HTMLInputElement): boolean {
  if (el.tagName !== "INPUT") return false;
  const hints = [el.autocomplete, el.name, el.id, el.placeholder].join(" ").toLowerCase();
  return /otp|code|token|pin|verify|auth/.test(hints);
}
