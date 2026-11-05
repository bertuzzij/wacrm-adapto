// ============================================================
// Categorias do seletor de emoji, traduzidas.
//
// A `emoji-picker-react` traz os nomes de categoria em inglês. O produto
// é em português, então os nomes vêm daqui — e daqui também vêm os
// rótulos de busca e de tom de pele, para o seletor não misturar idiomas.
//
// As chaves são o enum `Categories` da lib. Manter o mapa total
// (`Record<CategoryKey, string>`) faz o `tsc` avisar se a lib ganhar ou
// renomear uma categoria numa atualização.
// ============================================================

import { Categories, type CategoryConfig } from 'emoji-picker-react';

export type CategoryKey = `${Categories}`;

/**
 * Ordem em que as categorias aparecem no seletor.
 *
 * `suggested` e `custom` ficam de fora de propósito: a primeira é pessoal
 * do usuário e a segunda é para emojis de servidor — nenhuma das duas
 * existe nesta instalação.
 */
export const CATEGORY_ORDER: Categories[] = [
  Categories.SMILEYS_PEOPLE,
  Categories.ANIMALS_NATURE,
  Categories.FOOD_DRINK,
  Categories.TRAVEL_PLACES,
  Categories.ACTIVITIES,
  Categories.OBJECTS,
  Categories.SYMBOLS,
  Categories.FLAGS,
];

/** Nome de cada categoria, por idioma da instalação. */
const CATEGORY_NAMES: Record<string, Record<CategoryKey, string>> = {
  pt: {
    smileys_people: 'Carinhas e pessoas',
    animals_nature: 'Animais e natureza',
    food_drink: 'Comida e bebida',
    travel_places: 'Viagem e lugares',
    activities: 'Atividades',
    objects: 'Objetos',
    symbols: 'Símbolos',
    flags: 'Bandeiras',
    suggested: 'Sugeridos',
    custom: 'Personalizados',
  },
  en: {
    smileys_people: 'Smileys & people',
    animals_nature: 'Animals & nature',
    food_drink: 'Food & drink',
    travel_places: 'Travel & places',
    activities: 'Activities',
    objects: 'Objects',
    symbols: 'Symbols',
    flags: 'Flags',
    suggested: 'Frequently used',
    custom: 'Custom',
  },
  es: {
    smileys_people: 'Caritas y personas',
    animals_nature: 'Animales y naturaleza',
    food_drink: 'Comida y bebida',
    travel_places: 'Viajes y lugares',
    activities: 'Actividades',
    objects: 'Objetos',
    symbols: 'Símbolos',
    flags: 'Banderas',
    suggested: 'Frecuentes',
    custom: 'Personalizados',
  },
  ko: {
    smileys_people: '표정 및 사람',
    animals_nature: '동물 및 자연',
    food_drink: '음식 및 음료',
    travel_places: '여행 및 장소',
    activities: '활동',
    objects: '사물',
    symbols: '기호',
    flags: '깃발',
    suggested: '자주 사용',
    custom: '사용자 지정',
  },
};

/** Idioma conhecido, com queda para português — o padrão do produto. */
function normalizeLocale(locale: string | undefined): string {
  const base = (locale ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return base in CATEGORY_NAMES ? base : 'pt';
}

/** Nome traduzido de uma categoria. */
export function categoryName(
  category: Categories,
  locale: string | undefined
): string {
  const names = CATEGORY_NAMES[normalizeLocale(locale)];
  return names[category as CategoryKey] ?? String(category);
}

/**
 * Lista de categorias na ordem do seletor, com os nomes já traduzidos.
 *
 * É o formato que a prop `categories` espera (`CategoryConfig[]`).
 */
export function localizedCategories(locale: string | undefined): CategoryConfig[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    name: categoryName(category, locale),
  }));
}
