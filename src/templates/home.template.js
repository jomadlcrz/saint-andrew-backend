/**
 * Landing Page HTML Template
 * Replicates the classic minimalist St. Andrew Funeral Home placeholder
 * from the user-web commit (deep ink background, Playfair Display & Plus Jakarta Sans typography).
 */

function getHomePageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>St. Andrew Funeral Home — Care &amp; Compassion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      height: 100%;
      background-color: #0B1726;
      color: #F2F5F8;
      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .content {
      text-align: center;
      max-width: 28rem;
    }
    .title {
      font-family: "Playfair Display", Georgia, serif;
      font-size: clamp(1.875rem, 5vw, 2.25rem);
      font-weight: 600;
      color: #F2F5F8;
      letter-spacing: -0.01em;
      line-height: 1.25;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      <h1 class="title">St. Andrew Funeral Home</h1>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  getHomePageHtml,
};
