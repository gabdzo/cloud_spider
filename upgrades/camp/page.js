export const html = "<!doctype html><title>camp</title><p>cloudspider camp</p>";

export async function handler() {
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: html,
  };
}
