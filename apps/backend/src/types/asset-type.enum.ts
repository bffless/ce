export enum AssetType {
  COMMITS = 'commits',
  UPLOADS = 'uploads', // For future use
  STATIC = 'static', // For future use
}

export const ASSET_TYPE_VALUES = Object.values(AssetType);

export function isValidAssetType(value: string): value is AssetType {
  return ASSET_TYPE_VALUES.includes(value as AssetType);
}
