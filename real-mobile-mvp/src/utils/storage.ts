import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  AUTH_TOKEN: '@real/auth_token',
  USER_PROFILE: '@real/user_profile',
  ONBOARDING_COMPLETE: '@real/onboarding_complete',
  CACHE_PREFIX: '@real/cache/',
} as const;

export const storage = {
  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      const jsonValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, jsonValue);
    } catch (error) {
      console.error('Error saving to storage:', error);
      throw error;
    }
  },

  async getItem<T>(key: string): Promise<T | null> {
    try {
      const jsonValue = await AsyncStorage.getItem(key);
      return jsonValue != null ? JSON.parse(jsonValue) : null;
    } catch (error) {
      console.error('Error reading from storage:', error);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing from storage:', error);
      throw error;
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Error clearing storage:', error);
      throw error;
    }
  },

  async setWithExpiry<T>(key: string, value: T, ttl: number): Promise<void> {
    const item = {
      value,
      expiry: Date.now() + ttl,
    };
    await this.setItem(key, item);
  },

  async getWithExpiry<T>(key: string): Promise<T | null> {
    const item = await this.getItem<{ value: T; expiry: number }>(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      await this.removeItem(key);
      return null;
    }

    return item.value;
  },

  keys: STORAGE_KEYS,
};
