export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const validateEmail = (email: string): ValidationResult => {
  if (!email) {
    return { isValid: false, error: 'E-mail é obrigatório' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: 'E-mail inválido' };
  }
  return { isValid: true };
};

export const validatePassword = (password: string): ValidationResult => {
  if (!password) {
    return { isValid: false, error: 'Senha é obrigatória' };
  }
  if (password.length < 6) {
    return { isValid: false, error: 'Senha deve ter pelo menos 6 caracteres' };
  }
  return { isValid: true };
};

export const validatePhone = (phone: string): ValidationResult => {
  if (!phone) {
    return { isValid: false, error: 'Telefone é obrigatório' };
  }
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 11) {
    return { isValid: false, error: 'Telefone inválido' };
  }
  return { isValid: true };
};

export const validateCPF = (cpf: string): ValidationResult => {
  if (!cpf) {
    return { isValid: false, error: 'CPF é obrigatório' };
  }
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) {
    return { isValid: false, error: 'CPF deve ter 11 dígitos' };
  }

  if (/^(\d)\1{10}$/.test(cleaned)) {
    return { isValid: false, error: 'CPF inválido' };
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned.charAt(i)) * (10 - i);
  }
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cleaned.charAt(9))) {
    return { isValid: false, error: 'CPF inválido' };
  }

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned.charAt(i)) * (11 - i);
  }
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cleaned.charAt(10))) {
    return { isValid: false, error: 'CPF inválido' };
  }

  return { isValid: true };
};

export const validateRequired = (value: string, fieldName: string): ValidationResult => {
  if (!value || value.trim() === '') {
    return { isValid: false, error: `${fieldName} é obrigatório` };
  }
  return { isValid: true };
};

export const validateURL = (url: string): ValidationResult => {
  if (!url) {
    return { isValid: false, error: 'URL é obrigatória' };
  }
  try {
    new URL(url);
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'URL inválida' };
  }
};

export const validateBudget = (budget: string): ValidationResult => {
  if (!budget) {
    return { isValid: false, error: 'Orçamento é obrigatório' };
  }
  const cleaned = budget.replace(/[^\d,]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  if (isNaN(value) || value <= 0) {
    return { isValid: false, error: 'Orçamento deve ser um valor positivo' };
  }
  return { isValid: true };
};
