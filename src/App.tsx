import React, { useState, useRef } from 'react';
import { generateStoryboard, generateImageForScene, generatePromptForScene } from './services/geminiService';
import { Scene, Character } from './types';
import { Loader2, Image as ImageIcon, Play, Wand2, RefreshCw, Download, Upload, Plus, Trash2, UserPlus, Sparkles, FileText } from 'lucide-react';
import JSZip from 'jszip';

export default function App() {
  const [style, setStyle] = useState('dark fantasy ink illustration como Junji Ito');
  const [story, setStory] = useState('');
  const [batchScenesText, setBatchScenesText] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [casting, setCasting] = useState<Character[]>([]);
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    const zip = new JSZip();
    const projectData = { style, story, casting, scenes };
    
    // Save JSON project file
    zip.file('storyboard-project.json', JSON.stringify(projectData, null, 2));

    // Create a folder for images
    const imagesFolder = zip.folder('images');
    if (imagesFolder) {
      scenes.forEach((scene) => {
        if (scene.imageUrl) {
          const base64Data = scene.imageUrl.split(',')[1];
          if (base64Data) {
            imagesFolder.file(`cena_${scene.sceneNumber}.png`, base64Data, { base64: true });
          }
        }
      });
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'storyboard-project.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const projectData = JSON.parse(content);
        if (projectData.style !== undefined) setStyle(projectData.style);
        if (projectData.story !== undefined) setStory(projectData.story);
        if (projectData.casting !== undefined) setCasting(projectData.casting);
        if (projectData.scenes !== undefined) setScenes(projectData.scenes);
      } catch (err) {
        console.error('Failed to parse project file', err);
        alert('Erro ao importar o projeto. Arquivo inválido.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleAddCharacter = () => {
    setCasting([...casting, { id: crypto.randomUUID(), name: '', prompt: '', referenceImage: undefined }]);
  };

  const handleUpdateCharacter = (id: string, field: keyof Character, value: string) => {
    setCasting(casting.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleRemoveCharacter = (id: string) => {
    setCasting(casting.filter(c => c.id !== id));
    // Remove from scenes as well
    setScenes(scenes.map(s => ({
      ...s,
      selectedCharacterIds: s.selectedCharacterIds?.filter(cId => cId !== id)
    })));
  };

  const handleCharacterImageUpload = (id: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      handleUpdateCharacter(id, 'referenceImage', base64);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateStoryboard = async () => {
    if (!style || !story) {
      setError('Por favor, preencha o estilo e a história.');
      return;
    }

    setIsGeneratingStoryboard(true);
    setError(null);
    setScenes([]);

    try {
      const generatedScenes = await generateStoryboard(style, story);
      // Auto-select all characters for all scenes by default? Or leave empty.
      // We will leave empty and let user select, or maybe auto-select if name matches?
      // For simplicity, leave empty.
      setScenes(generatedScenes.map(s => ({ ...s, selectedCharacterIds: [] })));
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Ocorreu um erro ao gerar o storyboard.');
    } finally {
      setIsGeneratingStoryboard(false);
    }
  };

  const handleBatchAddScenes = () => {
    if (!batchScenesText.trim()) return;
    const lines = batchScenesText.split('\n').filter(line => line.trim().length > 0);
    const newScenes: Scene[] = lines.map((line, idx) => ({
      sceneNumber: scenes.length + idx + 1,
      textExcerpt: line.trim(),
      characters: '',
      selectedCharacterIds: [],
      visualPrompt: '',
    }));
    setScenes([...scenes, ...newScenes]);
    setBatchScenesText('');
  };

  const handleGenerateImage = async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;

    setScenes((prev) => {
      const newScenes = [...prev];
      newScenes[index] = { ...newScenes[index], isGeneratingImage: true };
      return newScenes;
    });

    try {
      const selectedChars = casting.filter(c => scene.selectedCharacterIds?.includes(c.id));
      const imageUrl = await generateImageForScene(scene.visualPrompt, style, selectedChars);
      setScenes((prev) => {
        const newScenes = [...prev];
        newScenes[index] = { ...newScenes[index], imageUrl, isGeneratingImage: false };
        return newScenes;
      });
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao gerar imagem para a cena ${scene.sceneNumber}: ${err.message}`);
      setScenes((prev) => {
        const newScenes = [...prev];
        newScenes[index] = { ...newScenes[index], isGeneratingImage: false };
        return newScenes;
      });
    }
  };

  const handleGenerateAllImages = async () => {
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i].imageUrl && !scenes[i].isGeneratingImage && scenes[i].visualPrompt) {
        await handleGenerateImage(i);
        // Add a small delay to avoid hitting rate limits too quickly
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  };

  const handleGenerateAllPrompts = async () => {
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i].visualPrompt) {
        await handleGeneratePromptForScene(i);
        // Add a small delay to avoid hitting rate limits too quickly
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  };

  const toggleCharacterInScene = (sceneIndex: number, characterId: string) => {
    setScenes(prev => {
      const newScenes = [...prev];
      const scene = newScenes[sceneIndex];
      const selected = scene.selectedCharacterIds || [];
      if (selected.includes(characterId)) {
        scene.selectedCharacterIds = selected.filter(id => id !== characterId);
      } else {
        scene.selectedCharacterIds = [...selected, characterId];
      }
      return newScenes;
    });
  };

  const handleGeneratePromptForScene = async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;

    try {
      const selectedChars = casting.filter(c => scene.selectedCharacterIds?.includes(c.id));
      const prompt = await generatePromptForScene(style, scene.textExcerpt, selectedChars);
      setScenes(prev => {
        const newScenes = [...prev];
        newScenes[index] = { ...newScenes[index], visualPrompt: prompt };
        return newScenes;
      });
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao gerar prompt para a cena ${scene.sceneNumber}: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">AI Storyboard Pro</h1>
          </div>
          <div className="flex items-center gap-3">
            <input 
              type="file" 
              accept=".json" 
              ref={fileInputRef} 
              onChange={handleImport} 
              className="hidden" 
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-700/50"
            >
              <Upload className="w-4 h-4" />
              Importar
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-700/50"
            >
              <Download className="w-4 h-4" />
              Exportar
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Inputs */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Configuração */}
          <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800 shadow-sm">
            <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">1</span>
              Configuração
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Estilo Global
                </label>
                <input
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="Ex: dark fantasy ink illustration como Junji Ito"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Gerar Storyboard Automático (IA)
                </label>
                <textarea
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  placeholder="Cole sua história ou roteiro aqui..."
                  rows={6}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none"
                />
                <button
                  onClick={handleGenerateStoryboard}
                  disabled={isGeneratingStoryboard || !story.trim()}
                  className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingStoryboard ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analisando Narrativa...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Gerar Storyboard
                    </>
                  )}
                </button>
              </div>
              
              <div className="pt-4 border-t border-zinc-800">
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Ou Adicionar Cenas em Lote (1 por linha)
                </label>
                <textarea
                  value={batchScenesText}
                  onChange={(e) => setBatchScenesText(e.target.value)}
                  placeholder="Cena 1...\nCena 2...\nCena 3..."
                  rows={4}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-none"
                />
                <button
                  onClick={handleBatchAddScenes}
                  disabled={!batchScenesText.trim()}
                  className="w-full mt-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl px-4 py-3 text-sm font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Cenas
                </button>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Casting */}
          <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">2</span>
                Casting (Elenco)
              </h2>
              <button
                onClick={handleAddCharacter}
                className="text-indigo-400 hover:text-indigo-300 transition-colors p-1"
                title="Adicionar Personagem"
              >
                <UserPlus className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              {casting.length === 0 ? (
                <p className="text-sm text-zinc-500 text-center py-4">Nenhum personagem adicionado.</p>
              ) : (
                casting.map(char => (
                  <div key={char.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 relative group">
                    <button 
                      onClick={() => handleRemoveCharacter(char.id)}
                      className="absolute top-2 right-2 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={char.name}
                        onChange={(e) => handleUpdateCharacter(char.id, 'name', e.target.value)}
                        placeholder="Nome do Personagem"
                        className="w-full bg-transparent border-b border-zinc-800 pb-1 text-sm font-medium focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <textarea
                        value={char.prompt}
                        onChange={(e) => handleUpdateCharacter(char.id, 'prompt', e.target.value)}
                        placeholder="Prompt visual (ex: homem 30 anos, cicatrizes...)"
                        rows={2}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                      />
                      <div className="flex items-center gap-3">
                        {char.referenceImage ? (
                          <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-zinc-700">
                            <img src={char.referenceImage} alt={char.name} className="w-full h-full object-cover" />
                            <button 
                              onClick={() => handleUpdateCharacter(char.id, 'referenceImage', '')}
                              className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-4 h-4 text-white" />
                            </button>
                          </div>
                        ) : (
                          <label className="flex items-center justify-center w-12 h-12 rounded-lg border border-dashed border-zinc-700 hover:border-indigo-500 hover:bg-indigo-500/10 cursor-pointer transition-colors">
                            <Upload className="w-4 h-4 text-zinc-500" />
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => handleCharacterImageUpload(char.id, e)}
                            />
                          </label>
                        )}
                        <span className="text-xs text-zinc-500">Imagem de Referência</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Right Column: Storyboard */}
        <div className="lg:col-span-8">
          <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800 shadow-sm min-h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">3</span>
                Cenas Geradas
              </h2>
              
              {scenes.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateAllPrompts}
                    className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    Gerar Todos os Prompts
                  </button>
                  <button
                    onClick={handleGenerateAllImages}
                    className="text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Gerar Todas as Imagens
                  </button>
                </div>
              )}
            </div>

            {scenes.length === 0 ? (
              <div className="h-[400px] flex flex-col items-center justify-center text-zinc-500">
                <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
                <p>O storyboard aparecerá aqui.</p>
                <p className="text-sm mt-1">Gere automaticamente ou adicione em lote.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {scenes.map((scene, index) => (
                  <div key={index} className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden flex flex-col md:flex-row">
                    {/* Scene Details */}
                    <div className="p-5 flex-1 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-mono text-indigo-400 text-sm font-semibold">
                          CENA {scene.sceneNumber}
                        </h3>
                        <button 
                          onClick={() => setScenes(scenes.filter((_, i) => i !== index))}
                          className="text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="space-y-4 flex-1">
                        {scene.textExcerpt && (
                          <div>
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Trecho do Texto</h4>
                            <p className="text-sm text-zinc-300 leading-relaxed italic border-l-2 border-indigo-500/50 pl-3 py-1">
                              "{scene.textExcerpt}"
                            </p>
                          </div>
                        )}
                        
                        {casting.length > 0 && (
                          <div>
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Casting na Cena</h4>
                            <div className="flex flex-wrap gap-2">
                              {casting.map(char => {
                                const isSelected = scene.selectedCharacterIds?.includes(char.id);
                                return (
                                  <button
                                    key={char.id}
                                    onClick={() => toggleCharacterInScene(index, char.id)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                                      isSelected 
                                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50' 
                                        : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700'
                                    }`}
                                  >
                                    {char.name || 'Sem Nome'}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        
                        <div className="flex-1 flex flex-col">
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Prompt Visual</h4>
                            <button 
                              onClick={() => handleGeneratePromptForScene(index)}
                              className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                            >
                              <Sparkles className="w-3 h-3" />
                              Gerar Prompt
                            </button>
                          </div>
                          <textarea
                            value={scene.visualPrompt}
                            onChange={(e) => {
                              const newScenes = [...scenes];
                              newScenes[index].visualPrompt = e.target.value;
                              setScenes(newScenes);
                            }}
                            placeholder="Descreva a cena para a IA de imagem..."
                            className="w-full flex-1 min-h-[100px] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-indigo-500 transition-colors resize-y font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Image Area */}
                    <div className="w-full md:w-[400px] bg-zinc-900 flex flex-col items-center justify-center p-4 relative min-h-[225px]">
                      {scene.imageUrl ? (
                        <img 
                          src={scene.imageUrl} 
                          alt={`Cena ${scene.sceneNumber}`} 
                          className="w-full h-auto rounded-lg shadow-lg border border-zinc-800"
                        />
                      ) : (
                        <div className="text-center w-full h-full flex flex-col items-center justify-center">
                          {scene.isGeneratingImage ? (
                            <div className="flex flex-col items-center text-indigo-400">
                              <Loader2 className="w-8 h-8 animate-spin mb-3" />
                              <span className="text-sm font-medium">Gerando Imagem...</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleGenerateImage(index)}
                              disabled={!scene.visualPrompt.trim()}
                              className="flex flex-col items-center text-zinc-500 hover:text-zinc-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <div className="w-12 h-12 rounded-full bg-zinc-800 group-hover:bg-zinc-700 flex items-center justify-center mb-3 transition-colors">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                              <span className="text-sm font-medium">
                                {scene.visualPrompt.trim() ? 'Gerar Imagem' : 'Adicione um Prompt Visual'}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
