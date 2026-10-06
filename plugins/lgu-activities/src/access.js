// Presentation gate only. Future Core/LGU authorization MUST be server-side.
function isTeacher(result) {
  return result?.loading === false && !result.error
    && result.data?.role === 'MODERATOR';
}

module.exports = { isTeacher };