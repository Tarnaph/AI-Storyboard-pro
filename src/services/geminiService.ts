import { GoogleGenAI, Type } from "@google/genai";
import { Scene, Character } from "../types";

export async function generateStoryboard(style: string, story: string): Promise<Scene[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Você é um especialista em adaptação de narrativas para geração de imagens por IA.
Siga estes passos exatamente:

1. Estilo Global: O usuário escolheu o estilo: "${style}". Aplique esse estilo a TODAS as cenas, incluindo: composição, iluminação, paleta de cores/texturas, mood e aspect ratio.
2. Texto de Entrada: Analise o texto longo fornecido abaixo, dividindo-o em cenas lógicas e sequenciais. Cada cena deve durar 3-8 segundos em um vídeo.
3. Para Cada Cena:
   - Trecho do Texto: Inclua o trecho exato do texto original correspondente a esta cena.
   - Personagens: Liste todos os personagens presentes. Mantenha consistência visual entre cenas.
   - Descrição Visual: Crie um prompt pronto para IA de imagem (200-300 palavras), otimizado para alta qualidade: descreva composição precisa, ângulos de câmera, expressões, poses, ambiente, efeitos e o estilo escolhido.

Texto de Entrada:
${story}`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            sceneNumber: {
              type: Type.INTEGER,
              description: "O número sequencial da cena",
            },
            textExcerpt: {
              type: Type.STRING,
              description: "O trecho exato do texto original correspondente a esta cena",
            },
            characters: {
              type: Type.STRING,
              description: "A lista e descrição dos personagens na cena",
            },
            visualPrompt: {
              type: Type.STRING,
              description: "O prompt visual detalhado para a IA de imagem (em inglês, pois a maioria das IAs de imagem entende melhor inglês)",
            },
          },
          required: ["sceneNumber", "textExcerpt", "characters", "visualPrompt"],
        },
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Nenhuma resposta recebida da IA.");
  }

  try {
    const scenes: Scene[] = JSON.parse(text);
    return scenes;
  } catch (e) {
    console.error("Failed to parse JSON", text);
    throw new Error("Erro ao interpretar a resposta da IA como JSON.");
  }
}

export async function generateImageForScene(prompt: string, style: string, characters: Character[] = []): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const ai = new GoogleGenAI({ apiKey });

  let fullPrompt = `Style: ${style}. \nScene description: ${prompt}`;
  if (characters.length > 0) {
    fullPrompt += `\nCharacters in scene:\n` + characters.map(c => `- ${c.name}: ${c.prompt}`).join('\n');
    fullPrompt += `\n(Please maintain character consistency with the provided reference images if any).`;
  }

  const parts: any[] = [];
  
  for (const char of characters) {
    if (char.referenceImage) {
      const match = char.referenceImage.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        });
      }
    }
  }

  parts.push({ text: fullPrompt });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: parts,
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9",
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      const base64EncodeString: string = part.inlineData.data;
      return `data:image/png;base64,${base64EncodeString}`;
    }
  }

  throw new Error("Nenhuma imagem retornada pela IA.");
}

export async function generatePromptForScene(style: string, textExcerpt: string, characters: Character[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  const ai = new GoogleGenAI({ apiKey });

  let prompt = `Você é um especialista em adaptação de narrativas para geração de imagens por IA.
Crie um prompt visual (em inglês, 200-300 palavras) para a seguinte cena.
Estilo Global: "${style}"
Trecho da Cena: "${textExcerpt}"
`;
  if (characters.length > 0) {
    prompt += `Personagens presentes:\n` + characters.map(c => `- ${c.name}: ${c.prompt}`).join('\n');
  }
  prompt += `\nDescreva composição precisa, ângulos de câmera, expressões, poses, ambiente, efeitos e o estilo escolhido. Retorne APENAS o prompt visual em inglês, sem explicações adicionais.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
  });

  return response.text || "";
}
