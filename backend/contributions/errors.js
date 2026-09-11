class ReviewError extends Error {
  constructor(code, message, status = 409) {
    super(message); this.name = 'ReviewError'; this.code = code; this.status = status;
  }
}
function fail(code, message, status) { throw new ReviewError(code, message, status); }
function requireValue(value, code, message, status) { if (!value) fail(code, message, status); }
function publicError(error) {
  return error instanceof ReviewError ? { code: error.code, error: error.message } :
    { code: 'REVIEW_INTERNAL', error: 'Không thể hoàn tất thao tác. Xem mã sự kiện và thử lại.' };
}
module.exports = { ReviewError, fail, requireValue, publicError };
