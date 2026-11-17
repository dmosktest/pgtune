import type { HdType, MemoryUnit, TuneInput } from "./tune";
import type { ManagedTarget } from "./export-formats";

export type InstancePresetId =
  | "custom"
  | "aws_r6g_large"
  | "aws_r6g_xlarge"
  | "aws_r6g_2xlarge"
  | "aws_m6g_large"
  | "aws_m6g_xlarge"
  | "yc_s3_c4_m16"
  | "yc_s3_c8_m32"
  | "yc_s3_c16_m64";

export type InstancePreset = {
  id: InstancePresetId;
  /** i18n key for the option label */
  labelKey: string;
  totalMemory: number;
  totalMemoryUnit: MemoryUnit;
  cpuNum: number;
  hdType: HdType;
  pgRamPercent: number;
  managed: ManagedTarget;
};

export const INSTANCE_PRESETS: InstancePreset[] = [
  {
    id: "custom",
    labelKey: "presetCustom",
    totalMemory: 16,
    totalMemoryUnit: "GB",
    cpuNum: 8,
    hdType: "ssd",
    pgRamPercent: 100,
    managed: "selfhosted",
  },
  {
    id: "aws_r6g_large",
    labelKey: "presetAwsR6gLarge",
    totalMemory: 16,
    totalMemoryUnit: "GB",
    cpuNum: 2,
    hdType: "ssd",
    pgRamPercent: 85,
    managed: "rds",
  },
  {
    id: "aws_r6g_xlarge",
    labelKey: "presetAwsR6gXlarge",
    totalMemory: 32,
    totalMemoryUnit: "GB",
    cpuNum: 4,
    hdType: "ssd",
    pgRamPercent: 85,
    managed: "rds",
  },
  {
    id: "aws_r6g_2xlarge",
    labelKey: "presetAwsR6g2xlarge",
    totalMemory: 64,
    totalMemoryUnit: "GB",
    cpuNum: 8,
    hdType: "ssd",
    pgRamPercent: 85,
    managed: "rds",
  },
  {
    id: "aws_m6g_large",
    labelKey: "presetAwsM6gLarge",
    totalMemory: 8,
    totalMemoryUnit: "GB",
    cpuNum: 2,
    hdType: "ssd",
    pgRamPercent: 85,
    managed: "rds",
  },
  {
    id: "aws_m6g_xlarge",
    labelKey: "presetAwsM6gXlarge",
    totalMemory: 16,
    totalMemoryUnit: "GB",
    cpuNum: 4,
    hdType: "ssd",
    pgRamPercent: 85,
    managed: "rds",
  },
  {
    id: "yc_s3_c4_m16",
    labelKey: "presetYcS3C4M16",
    totalMemory: 16,
    totalMemoryUnit: "GB",
    cpuNum: 4,
    hdType: "ssd",
    pgRamPercent: 85,
    managed: "yandex",
  },
  {
    id: "yc_s3_c8_m32",
    labelKey: "presetYcS3C8M32",
    totalMemory: 32,
    totalMemoryUnit: "GB",
    cpuNum: 8,
    hdType: "nvme",
    pgRamPercent: 85,
    managed: "yandex",
  },
  {
    id: "yc_s3_c16_m64",
    labelKey: "presetYcS3C16M64",
    totalMemory: 64,
    totalMemoryUnit: "GB",
    cpuNum: 16,
    hdType: "nvme",
    pgRamPercent: 85,
    managed: "yandex",
  },
];

export function findPreset(id: string): InstancePreset | undefined {
  return INSTANCE_PRESETS.find((p) => p.id === id);
}

export function applyPresetToInput(
  input: TuneInput,
  preset: InstancePreset,
): TuneInput {
  if (preset.id === "custom") return input;
  return {
    ...input,
    totalMemory: preset.totalMemory,
    totalMemoryUnit: preset.totalMemoryUnit,
    cpuNum: preset.cpuNum,
    hdType: preset.hdType,
    pgRamPercent: preset.pgRamPercent,
  };
}
