// Namespace names that modules below the services layer need (diagnostics
// sanitizing, migrations). A leaf module, so importing a name never pulls in
// a service and its `new Namespace(...)` before namespace.ts has loaded.

export const CREDENTIALS_NAMESPACE = 'registrar-credentials';
