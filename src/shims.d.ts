declare var process: any;
declare var Buffer: any;

declare module 'dotenv' {
  const config: () => void;
  export { config };
  export default { config: config };
}

declare module 'axios' {
  const axios: any;
  export default axios;
}

declare module '@ton/core' {
  export const Cell: any;
  export const Address: any;
}

declare module '@ton/ton' {
  const ton: any;
  export default ton;
}

declare module 'papaparse' {
  const Papa: any;
  export const unparse: any;
  export default Papa;
}

declare module 'fs';
declare module 'buffer';
