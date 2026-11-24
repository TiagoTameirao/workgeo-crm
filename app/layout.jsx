import "./globals.css";
import "leaflet/dist/leaflet.css";
export const metadata = {
  title: "WorkGeo | CRM",
  description: "Relacionamento, prospecção e operação WorkGeo",
  robots: { index: false, follow: false },
};
export default function Layout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
