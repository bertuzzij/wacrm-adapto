// ============================================================
// Classificação de nome de contato (nome real vs apenas número) e
// iniciais para o avatar na lista de Contatos.
//
// Espelha exatamente o predicado SQL da migração 076
// (`filter_contacts_adapto`), para que o filtro server-side e o
// fallback visual do avatar concordem sempre.
// ============================================================

export const CONTACT_NAME_FILTERS = ['all', 'named', 'phone_only'] as const;
export type ContactNameFilter = (typeof CONTACT_NAME_FILTERS)[number];

const PHONE_ONLY_CHARS = /^[+0-9 ()-]+$/;
const HAS_DIGIT = /[0-9]/;

/**
 * `true` quando o contato não tem nome real — está vazio ou guarda
 * apenas dígitos/formatação de telefone (ex.: "5516992535543",
 * "+55 (16) 99253-5543").
 */
export function isPhoneOnlyName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return true;
  return PHONE_ONLY_CHARS.test(trimmed) && HAS_DIGIT.test(trimmed);
}

/**
 * Iniciais para exibir quando o contato não tem foto.
 *
 * Devolve `null` quando o nome é apenas o número (ou ausente), para o
 * avatar mostrar um ícone genérico em vez de "55".
 */
export function contactInitials(name: string | null | undefined): string | null {
  if (isPhoneOnlyName(name)) return null;
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
