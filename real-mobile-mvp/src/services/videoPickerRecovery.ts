import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import {
  __resetPickerRecoveryMutexForTests,
  pickVideoWithRecoveryCore,
  type PickerLogFn,
  type RecoveredVideoAsset,
} from "./videoPickerRecoveryCore";

export type { PickerLogFn, RecoveredVideoAsset };

export type PickVideoWithRecoveryInput = {
  traceId: string;
  timeoutMs?: number;
  maxSizeBytes?: number;
  log?: PickerLogFn;
};

export function __resetVideoPickerMutexForTests(): void {
  __resetPickerRecoveryMutexForTests();
}

export async function pickVideoWithRecovery(input: PickVideoWithRecoveryInput): Promise<RecoveredVideoAsset | null> {
  const commonGalleryOptions: Record<string, unknown> = {
    mediaTypes: ["videos"],
    quality: 1,
    allowsEditing: false,
    allowsMultipleSelection: false,
  };

  const galleryAttempts =
    Platform.OS === "ios"
      ? [
          {
            id: "gallery_preserve" as const,
            options: {
              ...commonGalleryOptions,
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
              videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
            },
          },
          {
            id: "gallery_compat" as const,
            options: {
              ...commonGalleryOptions,
              preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
              videoExportPreset: ImagePicker.VideoExportPreset.MediumQuality,
            },
          },
        ]
      : [
          {
            id: "gallery_default" as const,
            options: {
              ...commonGalleryOptions,
              videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
            },
          },
        ];

  return pickVideoWithRecoveryCore({
    traceId: input.traceId,
    timeoutMs: input.timeoutMs,
    maxSizeBytes: input.maxSizeBytes,
    log: input.log,
    galleryAttempts,
    documentPickerOptions: {
      type: "video/*",
      multiple: false,
      copyToCacheDirectory: true,
    },
    deps: {
      platform: Platform.OS,
      launchImageLibraryAsync: ImagePicker.launchImageLibraryAsync,
      getDocumentAsync: DocumentPicker.getDocumentAsync,
      copyAsync: FileSystem.copyAsync,
      getInfoAsync: async (uri: string) => {
        const info = await FileSystem.getInfoAsync(uri);
        return {
          exists: Boolean((info as { exists?: boolean }).exists),
          size: typeof (info as { size?: number }).size === "number" ? (info as { size: number }).size : null,
        };
      },
      cacheDirectory: FileSystem.cacheDirectory,
      documentDirectory: FileSystem.documentDirectory,
      sleepMs: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      nowMs: () => Date.now(),
      random: () => Math.random(),
    },
  });
}
