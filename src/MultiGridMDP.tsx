import { useState, useEffect, useRef } from 'react';
import { processChat, type ChatAction } from './api/openai';
import { generateFromPattern, validatePattern } from './patterns';

const MultiGridMDP = () => {
  const GRID_WIDTH = 20;
  const GRID_HEIGHT = 10;
  
  const generateMockRewards = (description: string) => {
    const grid = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill(0));
    const lower = description.toLowerCase();
    
    if (lower.includes('road')) {
      for (let i = 0; i < GRID_HEIGHT; i++) {
        grid[i][5] = 95;
        grid[i][15] = 95;
      }
      for (let j = 0; j < GRID_WIDTH; j++) {
        grid[3][j] = 95;
        grid[7][j] = 95;
      }
    } else if (lower.includes('beach') || lower.includes('scenic')) {
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          grid[i][j] = Math.max(0, 100 - (i * 10));
        }
      }
    } else if (lower.includes('traffic')) {
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          const noise = Math.random() * 30;
          grid[i][j] = Math.max(0, Math.min(100, 100 - (Math.abs(i - 5) * 8 + Math.abs(j - 10) * 3 + noise)));
        }
      }
    } else if (lower.includes('elevation') || lower.includes('terrain')) {
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          const distFromCenter = Math.abs(i - GRID_HEIGHT/2) + Math.abs(j - GRID_WIDTH/2);
          grid[i][j] = Math.max(20, 100 - distFromCenter * 4);
        }
      }
    } else if (lower.includes('safety') || lower.includes('crime')) {
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          const nearRoad = (Math.abs(i - 3) < 2 || Math.abs(i - 7) < 2 || Math.abs(j - 5) < 2 || Math.abs(j - 15) < 2);
          const inCorner = (i < 2 && j < 4) || (i < 2 && j > 15) || (i > 7 && j < 4) || (i > 7 && j > 15);
          if (nearRoad) grid[i][j] = 85;
          else if (inCorner) grid[i][j] = 40;
          else grid[i][j] = 65;
        }
      }
    } else {
      // Default: big cross pattern
      const centerRow = Math.floor(GRID_HEIGHT / 2);
      const centerCol = Math.floor(GRID_WIDTH / 2);
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          const onVertical = Math.abs(j - centerCol) <= 2;
          const onHorizontal = Math.abs(i - centerRow) <= 1;
          if (onVertical || onHorizontal) {
            grid[i][j] = 80;
          } else {
            grid[i][j] = 30;
          }
        }
      }
    }

    return grid;
  };

  const [layers, setLayers] = useState([
    { id: 1, name: 'Roads', weight: 0.5, originalWeight: 0.5, description: 'Highways', rewards: generateMockRewards('roads'), visible: true },
    { id: 2, name: 'Scenic Views', weight: 0.2, originalWeight: 0.2, description: 'Beach', rewards: generateMockRewards('beach'), visible: true },
    { id: 3, name: 'Traffic', weight: 0.15, originalWeight: 0.15, description: 'Congestion', rewards: generateMockRewards('traffic'), visible: true },
    { id: 4, name: 'Terrain', weight: 0.1, originalWeight: 0.1, description: 'Elevation', rewards: generateMockRewards('terrain'), visible: true },
    { id: 5, name: 'Safety', weight: 0.05, originalWeight: 0.05, description: 'Crime', rewards: generateMockRewards('safety'), visible: true }
  ]);

  const [goalCell, setGoalCell] = useState<{ row: number; col: number } | null>(null);
  const [policy, setPolicy] = useState<string[][] | null>(null);
  const [valueFunction, setValueFunction] = useState<number[][] | null>(null);
  const [iteration, setIteration] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hoveredLayer, setHoveredLayer] = useState<number | null>(null);
  const [converged, setConverged] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<number | null>(null);
  const [isPainting, setIsPainting] = useState(false);
  const [brushValue, setBrushValue] = useState(90);
  const [notification, setNotification] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0.9);
  const [speed, setSpeed] = useState(1000);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', text: 'Hello! Try: "Add a parks layer with 15% weight" or "Make roads have high values on the left"' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');

  const iterationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    if (notificationRef.current) clearTimeout(notificationRef.current);
    notificationRef.current = setTimeout(() => setNotification(null), 5000);
  };

  const paintCell = (row: number, col: number) => {
    if (!editingLayerId) return;
    const newValue = brushValue;
    setLayers(layers.map(l => {
      if (l.id !== editingLayerId) return l;
      const newRewards = l.rewards.map((r, i) =>
        i === row ? r.map((c, j) => j === col ? newValue : c) : [...r]
      );
      return { ...l, rewards: newRewards };
    }));
  };

  const calculateCombinedRewards = () => {
    const combined = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill(0));
    layers.filter(l => l.visible).forEach(layer => {
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          combined[i][j] += layer.rewards[i][j] * layer.weight;
        }
      }
    });
    return combined;
  };

  const improvePolicy = (currentV: number[][], rewards: number[][], gamma: number) => {
    const newPolicy = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill(null));
    for (let i = 0; i < GRID_HEIGHT; i++) {
      for (let j = 0; j < GRID_WIDTH; j++) {
        if (goalCell && i === goalCell.row && j === goalCell.col) {
          newPolicy[i][j] = 'goal';
          continue;
        }
        const actions = [
          { di: -1, dj: 0, dir: '↑' },
          { di: 1, dj: 0, dir: '↓' },
          { di: 0, dj: -1, dir: '←' },
          { di: 0, dj: 1, dir: '→' },
          { di: 0, dj: 0, dir: '⏺' }
        ];
        let bestAction = null;
        let bestValue = -Infinity;
        actions.forEach(action => {
          const ni = i + action.di;
          const nj = j + action.dj;
          let expectedValue = 0;
          if (ni >= 0 && ni < GRID_HEIGHT && nj >= 0 && nj < GRID_WIDTH) {
            const goalReward = (goalCell && ni === goalCell.row && nj === goalCell.col) ? 10000 : 0;
            const stepReward = rewards[i][j];
            expectedValue = goalReward + stepReward + gamma * currentV[ni][nj];
          } else {
            expectedValue = -Infinity;
          }
          if (expectedValue > bestValue) {
            bestValue = expectedValue;
            bestAction = action.dir;
          }
        });
        newPolicy[i][j] = bestAction || '→';
      }
    }
    return newPolicy;
  };

  const performPolicyIteration = () => {
    if (!goalCell || converged) return;
    const rewards = calculateCombinedRewards();
    if (!valueFunction || !policy) {
      const initialV = Array(GRID_HEIGHT).fill(0).map(() => Array(GRID_WIDTH).fill(0));
      const initialPolicy = improvePolicy(initialV, rewards, discount);
      setValueFunction(initialV);
      setPolicy(initialPolicy);
      setIteration(1);
      return;
    }
    
    const actionMap: Record<string, number[]> = { '↑': [-1, 0], '↓': [1, 0], '←': [0, -1], '→': [0, 1], '⏺': [0, 0] };
    const newV = valueFunction.map(row => [...row]);
    let maxDelta = Infinity;
    let evalCount = 0;
    while (maxDelta > 0.0001 && evalCount < 200) {
      maxDelta = 0;
      for (let i = 0; i < GRID_HEIGHT; i++) {
        for (let j = 0; j < GRID_WIDTH; j++) {
          if (goalCell && i === goalCell.row && j === goalCell.col) {
            newV[i][j] = 0;
            continue;
          }
          const action = policy[i][j];
          if (!action || action === 'goal') continue;
          const move = actionMap[action] || [0, 0];
          const ni = i + move[0];
          const nj = j + move[1];
          if (ni >= 0 && ni < GRID_HEIGHT && nj >= 0 && nj < GRID_WIDTH) {
            const goalReward = (goalCell && ni === goalCell.row && nj === goalCell.col) ? 10000 : 0;
            const stepReward = rewards[i][j];
            const newVal = goalReward + stepReward + discount * newV[ni][nj];
            maxDelta = Math.max(maxDelta, Math.abs(newVal - newV[i][j]));
            newV[i][j] = newVal;
          }
        }
      }
      evalCount++;
    }
    setValueFunction(newV);
    
    const newPolicy = improvePolicy(newV, rewards, discount);
    let policyChanged = false;
    for (let i = 0; i < GRID_HEIGHT && !policyChanged; i++) {
      for (let j = 0; j < GRID_WIDTH && !policyChanged; j++) {
        if (policy[i][j] !== newPolicy[i][j] && newPolicy[i][j] !== 'goal' && policy[i][j] !== 'goal') {
          policyChanged = true;
        }
      }
    }
    setPolicy(newPolicy);
    setIteration(prev => prev + 1);
    if (!policyChanged) {
      setConverged(true);
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (isRunning && goalCell && !converged) {
      iterationRef.current = setTimeout(() => {
        performPolicyIteration();
      }, speed);
    }
    return () => {
      if (iterationRef.current) {
        clearTimeout(iterationRef.current);
      }
    };
  }, [isRunning, iteration, valueFunction, policy, goalCell, discount, speed, converged]);

  useEffect(() => {
    if (policy || valueFunction) {
      setPolicy(null);
      setValueFunction(null);
      setIteration(0);
      setConverged(false);
      setIsRunning(false);
    }
  }, [layers]);

  const handleChat = async () => {
    if (!chatInput.trim() || isLoading) return;

    const userMessage = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const currentLayersContext = layers.map(l => ({ name: l.name, weight: l.weight }));
      const result: ChatAction = await processChat(userMessage, currentLayersContext, apiKey, chatHistory);

      // Execute the action
      if (result.action === 'add_layer' && result.layerName) {
        const weight = result.weight || 0.1;
        const name = result.layerName;

        const newLayer = {
          id: Math.max(...layers.map(l => l.id)) + 1,
          name: name,
          weight: weight,
          originalWeight: weight,
          description: name,
          rewards: (result.pattern && validatePattern(result.pattern))
            ? generateFromPattern(validatePattern(result.pattern)!, GRID_WIDTH, GRID_HEIGHT)
            : generateMockRewards(name.toLowerCase()),
          visible: true
        };

        const visibleLayers = layers.filter(l => l.visible);
        const totalWeight = visibleLayers.reduce((sum, l) => sum + l.weight, 0);
        const scaleFactor = (1 - weight) / totalWeight;
        const adjustedLayers = layers.map(l => ({
          ...l,
          weight: l.visible ? l.weight * scaleFactor : l.weight
        }));

        const newLayersList = [...adjustedLayers, newLayer];
        const visibleNewLayers = newLayersList.filter(l => l.visible);
        const newTotal = visibleNewLayers.reduce((sum, l) => sum + l.weight, 0);
        if (Math.abs(newTotal - 1.0) > 0.0001 && visibleNewLayers.length > 0) {
          const largestLayer = visibleNewLayers.reduce((max, l) => l.weight > max.weight ? l : max);
          const correction = 1.0 - newTotal;
          const correctedLayers = newLayersList.map(l =>
            l.id === largestLayer.id ? {...l, weight: l.weight + correction} : l
          );
          setLayers(correctedLayers);
        } else {
          setLayers(newLayersList);
        }
        showNotification(`Layer "${name}" added! Click ✏️ next to it to paint rewards, or describe the pattern via chat.`);
      } else if (result.action === 'change_weight' && result.layerName) {
        const foundLayer = layers.find(l => l.name.toLowerCase() === result.layerName.toLowerCase());
        if (foundLayer) {
          setLayers(layers.map(l => l.id === foundLayer.id ? {...l, weight: result.weight} : l));
        }
      } else if (result.action === 'delete_layer' && result.layerName) {
        const foundLayer = layers.find(l => l.name.toLowerCase() === result.layerName.toLowerCase());
        if (foundLayer) {
          setLayers(layers.filter(l => l.id !== foundLayer.id));
        }
      } else if (result.action === 'edit_rewards' && result.layerName && result.pattern) {
        const foundLayer = layers.find(l => l.name.toLowerCase() === result.layerName.toLowerCase());
        const validatedPattern = validatePattern(result.pattern);
        if (foundLayer && validatedPattern) {
          const newRewards = generateFromPattern(validatedPattern, GRID_WIDTH, GRID_HEIGHT);
          setLayers(layers.map(l => l.id === foundLayer.id ? { ...l, rewards: newRewards } : l));
        }
      } else if (result.action === 'rename_layer' && result.layerName && result.newName) {
        const foundLayer = layers.find(l => l.name.toLowerCase() === result.layerName.toLowerCase());
        if (foundLayer) {
          setLayers(layers.map(l => l.id === foundLayer.id ? { ...l, name: result.newName!, description: result.newName! } : l));
        }
      }

      setChatHistory(prev => [...prev, { role: 'assistant', text: result.message }]);
    } catch (error) {
      setChatHistory(prev => [...prev, { role: 'assistant', text: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const getColorForValue = (value: number) => {
    const intensity = Math.round((value / 100) * 255);
    const r = Math.round(255 - intensity * 0.5);
    const g = Math.round(intensity * 0.9);
    const b = Math.round(intensity * 0.3);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  };

  const displayGrid = editingLayerId
    ? layers.find(l => l.id === editingLayerId)?.rewards
    : hoveredLayer
    ? layers.find(l => l.id === hoveredLayer)?.rewards
    : calculateCombinedRewards();

  const totalWeight = layers.filter(l => l.visible).reduce((sum, l) => sum + l.weight, 0);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <div className="w-72 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-700">
          <h2 className="text-lg font-bold">📊 Layers</h2>
          <div className="mt-1 text-xs" style={{color: Math.abs(totalWeight - 1.0) < 0.001 ? '#34d399' : '#fbbf24'}}>
            Total: {totalWeight.toFixed(3)}
          </div>
          <p className="mt-1 text-xs text-gray-500">Chat to add/remove layers. Click ✏️ to paint rewards with adjustable brush value.</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {layers.map(layer => (
            <div key={layer.id} className="p-2 rounded border" style={{
              backgroundColor: layer.visible ? '#374151' : '#1f2937',
              borderColor: hoveredLayer === layer.id ? '#3b82f6' : '#4b5563',
              opacity: layer.visible ? 1 : 0.6
            }}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold cursor-pointer hover:text-blue-400"
                  onMouseEnter={() => setHoveredLayer(layer.id)}
                  onMouseLeave={() => setHoveredLayer(null)}>
                  {layer.name}
                </h3>
                <div className="flex gap-1">
                  <button onClick={() => {
                    setEditingLayerId(editingLayerId === layer.id ? null : layer.id);
                    setHoveredLayer(editingLayerId === layer.id ? null : layer.id);
                  }} className="text-sm" title="Edit layer rewards">
                    {editingLayerId === layer.id ? '✓' : '✏️'}
                  </button>
                  <button onClick={() => {
                    setLayers(layers.map(l => l.id === layer.id ? {...l, visible: !l.visible} : l));
                  }} className="text-sm">
                    {layer.visible ? '👁️' : '🚫'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-2">{layer.description}</p>
              <div className="flex items-center gap-2">
                <input type="range" min="0" max="1" step="0.01" value={layer.weight}
                  onChange={(e) => {
                    const newWeight = parseFloat(e.target.value);
                    setLayers(layers.map(l => l.id === layer.id ? {...l, weight: newWeight} : l));
                  }}
                  disabled={!layer.visible}
                  className="flex-1 h-1"
                  style={{opacity: layer.visible ? 1 : 0.3}}
                />
                <span className="text-xs text-gray-400 min-w-[40px] text-right">
                  {Math.round(layer.weight * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
        
        <div className="p-3 border-t border-gray-700">
          <h3 className="text-sm font-semibold mb-2">Parameters</h3>
          <div className="space-y-2 text-xs">
            <div>
              <label className="text-gray-400">Discount: {discount.toFixed(2)}</label>
              <input type="range" min="0.5" max="0.99" step="0.01" value={discount}
                onChange={(e) => setDiscount(parseFloat(e.target.value))} className="w-full h-1" />
            </div>
            <div>
              <label className="text-gray-400">Speed: {(1000/speed).toFixed(1)} it/s</label>
              <input type="range" min="100" max="2000" step="100" value={speed}
                onChange={(e) => setSpeed(parseInt(e.target.value))} className="w-full h-1" />
            </div>
          </div>
          {goalCell && <div className="text-xs text-gray-400 mt-2">🎯 [{goalCell.row}, {goalCell.col}]</div>}
          {iteration > 0 && <div className="text-xs mt-2"><span className="text-blue-400">Iter: {iteration}</span>{converged && <span className="text-green-400 ml-2">✓</span>}</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => setIsRunning(!isRunning)} disabled={!goalCell}
              className="flex-1 py-2 text-xs rounded-lg font-semibold bg-purple-600 hover:bg-purple-700 disabled:opacity-50">
              {isRunning ? '⏸ Pause' : '▶ Start'}
            </button>
            <button onClick={() => {
              setIsRunning(false);
              setPolicy(null);
              setValueFunction(null);
              setIteration(0);
              setConverged(false);
            }} className="py-2 px-3 text-xs rounded-lg font-semibold bg-gray-600 hover:bg-gray-700">
              ↻
            </button>
          </div>
        </div>
        
        <div className="p-3 border-t border-gray-700 flex flex-col min-h-[280px] max-h-96">
          <h3 className="text-sm font-semibold mb-2">💬 AI Assistant</h3>
          {!apiKey && (
            <div className="mb-2">
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter OpenAI API key to enable chat"
                className="w-full px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded" />
              <p className="text-xs text-gray-500 mt-1">Your key is not stored and is only used for this session.</p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto mb-2 p-2 bg-gray-900 rounded text-xs space-y-2">
            {chatHistory.map((msg, idx) => (
              <div key={idx} className="flex" style={{justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'}}>
                <div className="max-w-[80%] px-3 py-1 rounded" style={{
                  backgroundColor: msg.role === 'user' ? '#2563eb' : '#374151',
                  color: 'white'
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="px-3 py-1 rounded bg-gray-700 text-gray-400">
                  Thinking...
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleChat(); }}
              placeholder="e.g. Add parks layer / Make roads high on left"
              disabled={isLoading || !apiKey}
              className="flex-1 px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded disabled:opacity-50" />
            <button onClick={handleChat} disabled={isLoading || !apiKey} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded font-bold disabled:opacity-50">
              {isLoading ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-2 overflow-auto relative">
        {notification && (
          <div className="absolute top-4 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm shadow-lg z-10 flex items-center gap-2">
            <span>{notification}</span>
            <button onClick={() => setNotification(null)} className="text-white/70 hover:text-white font-bold">✕</button>
          </div>
        )}
        <div className="text-center">
          <h1 className="text-xl font-bold mb-1">
            {editingLayerId
              ? 'Editing: ' + layers.find(l => l.id === editingLayerId)?.name
              : hoveredLayer
              ? layers.find(l => l.id === hoveredLayer)?.name + ' Layer'
              : 'Combined MDP'}
          </h1>
          <p className="text-xs text-gray-400 mb-2">
            {editingLayerId
              ? `Click to paint (brush value: ${brushValue})`
              : goalCell ? (converged ? 'Converged!' : isRunning ? 'Solving...' : 'Click Start') : 'Click cell for goal'}
          </p>
          {editingLayerId && (
            <div className="flex items-center justify-center gap-3 mb-2">
              <span className="text-xs text-gray-400">0</span>
              <input type="range" min="0" max="100" step="1" value={brushValue}
                onChange={(e) => setBrushValue(parseInt(e.target.value))}
                className="w-48 h-1" />
              <span className="text-xs text-gray-400">100</span>
              <span className="text-xs font-semibold text-blue-400">{brushValue}</span>
            </div>
          )}
          <div
            className="inline-grid gap-0.5 bg-gray-700 p-1 rounded-lg select-none"
            style={{transform: 'scale(0.85)', cursor: editingLayerId ? 'crosshair' : 'pointer'}}
            onMouseUp={() => setIsPainting(false)}
            onMouseLeave={() => setIsPainting(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {displayGrid && displayGrid.map((row, i) => (
              <div key={i} className="flex gap-0.5">
                {row.map((value, j) => (
                  <div key={i + '-' + j} className="w-12 h-12 flex items-center justify-center text-xs rounded hover:scale-105"
                    style={{backgroundColor: getColorForValue(value)}}
                    onMouseDown={(e) => {
                      if (editingLayerId) {
                        e.preventDefault();
                        setIsPainting(true);
                        paintCell(i, j);
                      }
                    }}
                    onMouseEnter={() => {
                      if (editingLayerId && isPainting) {
                        paintCell(i, j);
                      }
                    }}
                    onClick={() => {
                      if (editingLayerId) return;
                      if (goalCell && (goalCell.row !== i || goalCell.col !== j)) {
                        setPolicy(null);
                        setValueFunction(null);
                        setIteration(0);
                        setConverged(false);
                        setIsRunning(false);
                      }
                      setGoalCell({ row: i, col: j });
                    }}>
                    {goalCell && goalCell.row === i && goalCell.col === j ? '🎯' :
                     policy && policy[i] && policy[i][j] && policy[i][j] !== 'goal' ?
                     <span className="text-base text-white font-bold">{policy[i][j]}</span> :
                     Math.round(value)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-center gap-3 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{backgroundColor: getColorForValue(0)}}></div>
              <span>Low</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{backgroundColor: getColorForValue(50)}}></div>
              <span>Med</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{backgroundColor: getColorForValue(100)}}></div>
              <span>High</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiGridMDP;