/**
 * Render a controlled error page for failures that reach Express.
 *
 * Client errors raised by Express or its body parsers (for example a
 * malformed request body, which carries status 400) keep their 4xx status
 * and receive a generic "Invalid Request" page.  Anything else is treated as
 * an unexpected server failure: it is logged on the server and answered
 * with a generic 500 page.
 *
 * Internal error details and stack traces are never sent to the browser.
 *
 * @param {Error} error The error passed to Express.
 * @param {import("express").Request} request Express request.
 * @param {import("express").Response} response Express response.
 * @param {import("express").NextFunction} next Express next callback.
 */
export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = Number(error.status ?? error.statusCode);

  if (status >= 400 && status < 500) {
    response.status(status).render("error", {
      title: "Invalid Request",
      message: "The request could not be processed. " +
        "Please check the submitted information and try again."
    });
    return;
  }

  console.error(error);

  response.status(500).render("error", {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again."
  });
}
