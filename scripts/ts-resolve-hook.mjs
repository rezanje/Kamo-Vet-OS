// Node type-stripping runs .ts files, but not extensionless relative imports ("./promo-syarat-hasil"): retry them with ".ts".
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (e) {
    if (e && e.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
    throw e;
  }
}
