declare global {
  namespace App {
    interface Locals {
      /** The signed-in operator's email; null under the shared-password
       *  fallback, which carries no identity. */
      email: string | null;
    }
  }
}

export {};
