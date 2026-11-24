import { withWorkflow } from "workflow/next";
export default withWorkflow({
  serverExternalPackages: ["pg", "nodemailer", "imapflow", "mailparser", "pdfjs-dist", "@napi-rs/canvas", "exceljs"],
  outputFileTracingIncludes: {
    '/api/bankdoc/*': ['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'node_modules/pdfjs-dist/standard_fonts/**/*', 'node_modules/pdfjs-dist/cmaps/**/*', 'node_modules/pdfjs-dist/wasm/**/*', 'data/gerdau-guidelines.json'],
    '/api/bulletins/*': ['data/bulletin-logo.png'],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
});
