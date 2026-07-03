// Promise-based confirm dialog. Components call `await confirmDialog(...)`;
// the <ConfirmHost/> (mounted once in MoneyHub) renders the styled modal.
// Falls back to window.confirm if the host isn't mounted (should not happen).

let host = null;

export function confirmDialog(opts) {
  const req = typeof opts === 'string' ? { message: opts } : { ...opts };
  return new Promise((resolve) => {
    if (!host) return resolve(window.confirm(req.message));
    host({ ...req, resolve });
  });
}

export function registerConfirmHost(fn) {
  host = fn;
  return () => {
    if (host === fn) host = null;
  };
}
