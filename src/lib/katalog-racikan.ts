export type BahanKatalog = {
  item_id: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
};

export type KatalogRacikan = {
  id: string;
  code: string;
  active: boolean;
  version_id: string;
  version: number;
  name: string;
  dosage_form: string;
  dosage_instruction: string | null;
  ingredients: BahanKatalog[];
};

export function katalogTotal(ingredients: readonly BahanKatalog[]): number {
  return ingredients.reduce((total, ingredient) => total + ingredient.quantity * ingredient.unit_price, 0);
}

export function katalogFromRows(
  formulas: readonly { id: string; code: string; active: boolean; current_version_id: string | null }[],
  versions: readonly { id: string; version: number; name: string; dosage_form: string; dosage_instruction: string | null; ingredients: BahanKatalog[] }[],
): KatalogRacikan[] {
  const byId = new Map(versions.map((version) => [version.id, version]));
  return formulas.flatMap((formula) => {
    const version = formula.current_version_id ? byId.get(formula.current_version_id) : null;
    return version ? [{
      id: formula.id, code: formula.code, active: formula.active,
      version_id: version.id, version: version.version, name: version.name,
      dosage_form: version.dosage_form, dosage_instruction: version.dosage_instruction,
      ingredients: version.ingredients,
    }] : [];
  });
}
