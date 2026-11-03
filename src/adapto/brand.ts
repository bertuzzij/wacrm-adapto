/**
 * Identidade desta instalação.
 *
 * Por que um módulo e não uma string espalhada: o nome aparece no título da
 * aba do navegador, na sidebar e em textos de convite/onboarding. Trocá-lo
 * em cinco lugares diferentes é como se acaba com três grafias diferentes
 * na mesma tela.
 *
 * Isto é o ponto de renomeação do fork. Mudar `APP_NAME` aqui e a chave
 * `Sidebar.title` nos dicionários é o suficiente para a interface inteira;
 * os textos que citam o nome em prosa (convite, exclusão de modelo) usam a
 * chave de tradução e continuam funcionando.
 */

/** Nome exibido da aplicação. */
export const APP_NAME = 'AdaptoConect';

/** Sufixo do `<title>` das páginas: "Inbox — AdaptoConect". */
export const APP_TITLE_TEMPLATE = `%s — ${APP_NAME}`;
