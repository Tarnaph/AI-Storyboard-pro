export interface Character {
  id: string;
  name: string;
  prompt: string;
  referenceImage?: string;
}

export interface Scene {
  sceneNumber: number;
  textExcerpt: string;
  characters: string;
  selectedCharacterIds?: string[];
  visualPrompt: string;
  imageUrl?: string;
  isGeneratingImage?: boolean;
}
