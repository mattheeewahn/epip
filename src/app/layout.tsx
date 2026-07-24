import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calculator",
  description: "Simple calculator application",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='80' rx='10' fill='%23333'/><rect x='18' y='18' width='64' height='20' rx='4' fill='%2390EE90'/><rect x='18' y='46' width='14' height='14' rx='2' fill='%23666'/><rect x='38' y='46' width='14' height='14' rx='2' fill='%23666'/><rect x='58' y='46' width='14' height='14' rx='2' fill='%23666'/><rect x='78' y='46' width='14' height='14' rx='2' fill='%23f90'/><rect x='18' y='66' width='14' height='14' rx='2' fill='%23666'/><rect x='38' y='66' width='14' height='14' rx='2' fill='%23666'/><rect x='58' y='66' width='14' height='14' rx='2' fill='%23666'/><rect x='78' y='66' width='14' height='14' rx='2' fill='%23f90'/><rect x='18' y='86' width='34' height='14' rx='2' fill='%23666'/><rect x='58' y='86' width='14' height='14' rx='2' fill='%23666'/><rect x='78' y='86' width='14' height='14' rx='2' fill='%2390EE90'/></svg>",
  },
  referrer: "no-referrer",
  other: {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self';"
        />
      </head>
      <body className="app-container">{children}</body>
    </html>
  );
}
