// Acrescenta o namespace `Settings.pushNotifications` aos quatro dicionários.
//
// Paridade é obrigatória: messages.test.ts falha se um idioma tiver chave que
// outro não tem.
import { readFileSync, writeFileSync } from 'node:fs'

const TRANSLATIONS = {
  pt: {
    title: 'Notificações no celular',
    description:
      'Receba um aviso mesmo com o app FECHADO. É o que faz o celular apitar quando chega mensagem enquanto você não está com o sistema aberto.',
    toggleLabel: 'Avisar com o app fechado',
    toggleDesc: 'Usa Web Push. Cada aparelho precisa ser ativado separadamente.',
    statusOn: 'Ativo neste aparelho.',
    statusOff: 'Desligado neste aparelho.',
    enableNow: 'Ativar no celular',
    checking: 'Verificando…',
    unsupported: 'Este navegador não suporta notificações em segundo plano.',
    unsupportedInsecure:
      'Notificações exigem HTTPS. Abra o sistema pelo endereço seguro (https://), não por IP local.',
    unsupportedConfig:
      'O servidor ainda não tem as chaves de push configuradas. Avise o administrador.',
    iosNeedsInstall:
      'No iPhone, notificação só funciona com o app instalado na Tela de Início. Instale primeiro pelo card acima e volte aqui.',
    enabledToast: 'Notificações ativadas neste aparelho',
    disabledToast: 'Notificações desativadas neste aparelho',
    permissionDenied:
      'O navegador bloqueou as notificações. Libere para este site nas configurações e tente de novo.',
    failedToast: 'Não foi possível ativar as notificações',
  },
  en: {
    title: 'Phone notifications',
    description:
      'Get an alert even with the app CLOSED. This is what makes the phone buzz when a message arrives while you are not on the system.',
    toggleLabel: 'Alert with the app closed',
    toggleDesc: 'Uses Web Push. Every device must be enabled separately.',
    statusOn: 'Active on this device.',
    statusOff: 'Off on this device.',
    enableNow: 'Enable on this phone',
    checking: 'Checking…',
    unsupported: 'This browser does not support background notifications.',
    unsupportedInsecure:
      'Notifications require HTTPS. Open the system over the secure address (https://), not a local IP.',
    unsupportedConfig: 'The server has no push keys configured yet. Ask your administrator.',
    iosNeedsInstall:
      'On iPhone, notifications only work with the app installed to the Home Screen. Install it with the card above first, then come back.',
    enabledToast: 'Notifications enabled on this device',
    disabledToast: 'Notifications disabled on this device',
    permissionDenied:
      'The browser blocked notifications. Allow them for this site in the settings and try again.',
    failedToast: 'Could not enable notifications',
  },
  es: {
    title: 'Notificaciones en el móvil',
    description:
      'Recibe un aviso incluso con la app CERRADA. Es lo que hace vibrar el móvil cuando llega un mensaje mientras no estás en el sistema.',
    toggleLabel: 'Avisar con la app cerrada',
    toggleDesc: 'Usa Web Push. Cada dispositivo debe activarse por separado.',
    statusOn: 'Activo en este dispositivo.',
    statusOff: 'Desactivado en este dispositivo.',
    enableNow: 'Activar en el móvil',
    checking: 'Comprobando…',
    unsupported: 'Este navegador no admite notificaciones en segundo plano.',
    unsupportedInsecure:
      'Las notificaciones requieren HTTPS. Abre el sistema por la dirección segura (https://), no por IP local.',
    unsupportedConfig:
      'El servidor aún no tiene las claves de push configuradas. Avisa al administrador.',
    iosNeedsInstall:
      'En iPhone, las notificaciones solo funcionan con la app instalada en la pantalla de inicio. Instálala primero con la tarjeta de arriba y vuelve aquí.',
    enabledToast: 'Notificaciones activadas en este dispositivo',
    disabledToast: 'Notificaciones desactivadas en este dispositivo',
    permissionDenied:
      'El navegador bloqueó las notificaciones. Permítelas para este sitio en la configuración e inténtalo de nuevo.',
    failedToast: 'No se pudieron activar las notificaciones',
  },
  ko: {
    title: '휴대폰 알림',
    description:
      '앱을 닫은 상태에서도 알림을 받습니다. 시스템을 열어두지 않아도 메시지가 오면 휴대폰이 울립니다.',
    toggleLabel: '앱을 닫아도 알림',
    toggleDesc: 'Web Push를 사용합니다. 기기마다 따로 켜야 합니다.',
    statusOn: '이 기기에서 켜짐.',
    statusOff: '이 기기에서 꺼짐.',
    enableNow: '휴대폰에서 켜기',
    checking: '확인 중…',
    unsupported: '이 브라우저는 백그라운드 알림을 지원하지 않습니다.',
    unsupportedInsecure:
      '알림은 HTTPS가 필요합니다. 로컬 IP가 아닌 보안 주소(https://)로 접속하세요.',
    unsupportedConfig: '서버에 푸시 키가 설정되지 않았습니다. 관리자에게 알려주세요.',
    iosNeedsInstall:
      'iPhone에서는 홈 화면에 앱을 설치해야 알림이 작동합니다. 위 카드에서 먼저 설치한 후 다시 오세요.',
    enabledToast: '이 기기에서 알림이 켜졌습니다',
    disabledToast: '이 기기에서 알림이 꺼졌습니다',
    permissionDenied: '브라우저가 알림을 차단했습니다. 사이트 설정에서 허용한 후 다시 시도하세요.',
    failedToast: '알림을 켜지 못했습니다',
  },
}

for (const locale of Object.keys(TRANSLATIONS)) {
  const path = new URL(`../messages/${locale}.json`, import.meta.url)
  const catalogue = JSON.parse(readFileSync(path, 'utf8'))
  catalogue.Settings = catalogue.Settings ?? {}
  catalogue.Settings.pushNotifications = TRANSLATIONS[locale]
  writeFileSync(path, `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8')
  console.log(`${locale}: pushNotifications escrito`)
}
