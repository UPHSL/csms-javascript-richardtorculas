/**
 * Render a controlled error page for unexpected failures.
 *
 * Internal error details and stack traces are logged on the server only and
 * never sent to the browser.
 *
 * @param {Error} error The unexpected error.
 * @param {import("express").Request} request Express request.
 * @param {import("express").Response} response Express response.
 * @param {import("express").NextFunction} next Express next callback.
 */
export function errorHandler(error, request, response, next) {
  console.error(error);

  if (response.headersSent) {
    next(error);
    return;
  }

  response.status(500).render("error", {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again."
  });
}
