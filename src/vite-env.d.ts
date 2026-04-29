/// <reference types="vite/client" />

// Declare static asset imports so TypeScript accepts them
declare module '*.png' {
  const src: string;
  export default src;
}
// Vite ?inline query forces base64 data-URL encoding
declare module '*.png?inline' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
