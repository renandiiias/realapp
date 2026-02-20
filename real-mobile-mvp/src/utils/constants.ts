export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
} as const;

export const ANIMATION_DURATION = {
  fast: 200,
  normal: 300,
  slow: 500,
} as const;

export const TOUCH_TARGET_SIZE = 44;

export const ORDER_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export const ORDER_STATUS_LABELS = {
  pending: 'Pendente',
  in_progress: 'Em Progresso',
  completed: 'Concluído',
  cancelled: 'Cancelado',
} as const;

export const SERVICE_TYPES = {
  ADS: 'ads',
  SITE: 'site',
  CONTENT: 'content',
  VIDEO_EDITOR: 'video_editor',
} as const;

export const SERVICE_TYPE_LABELS = {
  ads: 'Anúncios',
  site: 'Site',
  content: 'Conteúdo',
  video_editor: 'Editor de Vídeo',
} as const;

export const TAB_BAR_HEIGHT = 70;

export const HEADER_HEIGHT = 60;

export const MIN_PASSWORD_LENGTH = 6;

export const DEBOUNCE_DELAY = 300;

export const DEFAULT_PAGINATION_LIMIT = 20;

export const CACHE_DURATION = {
  SHORT: 5 * 60 * 1000,
  MEDIUM: 15 * 60 * 1000,
  LONG: 60 * 60 * 1000,
} as const;
