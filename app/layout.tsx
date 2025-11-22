export default function RootLayout({children}:{children:React.ReactNode}){
  return (<html lang="pt"><head><link rel="manifest" href="/manifest.webmanifest" /></head><body>{children}</body></html>);
}