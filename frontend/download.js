// download.js
// Lets a visitor download this entire site's own frontend files as a zip,
// so they can run it locally. Self-contained — no dependency on wallet or
// contract state, so the button works whether or not a wallet is connected.

(function () {
  // Every file this site actually needs to run standalone, fetched by its
  // own relative URL — kept as a flat list rather than discovered
  // dynamically since a static site has no directory listing to query.
  const FILES = ["index.html", "style.css", "app.js", "config.js", "starfield.js", "download.js"];

  const btn = document.getElementById("download-all-btn");
  const status = document.getElementById("download-all-status");
  if (!btn) return;

  async function downloadAll() {
    btn.disabled = true;
    if (status) status.textContent = "Bundling files…";

    try {
      const zip = new JSZip();
      await Promise.all(
        FILES.map(async (name) => {
          const res = await fetch(name, { cache: "no-store" });
          if (!res.ok) throw new Error(`Failed to fetch ${name} (HTTP ${res.status})`);
          zip.file(name, await res.text());
        })
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "b0x-guess-website.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (status) status.textContent = "Downloaded — unzip and open index.html.";
    } catch (err) {
      if (status) status.textContent = `Download failed: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", downloadAll);
})();
