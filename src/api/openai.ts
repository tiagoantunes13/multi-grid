
const SYSTEM_PROMPT = `You are an assistant for an MDP grid visualization tool that helps manage layers.

Available actions:
- add_layer: Create a new layer with a name and weight (0.0 to 1.0)
- change_weight: Modify an existing layer's weight
- delete_layer: Remove a layer by name

You must respond with valid JSON only, no markdown or explanation:
{
  "action": "add_layer" | "change_weight" | "delete_layer" | "unknown",
  "layerName": "string (the layer name)",
  "weight": number (0.0 to 1.0, only for add_layer and change_weight),
  "message": "string (friendly response to show the user)"
}

Examples:
- "Add a hospital layer with 20% weight" → {"action": "add_layer", "layerName": "Hospital", "weight": 0.2, "message": "Added Hospital layer with 20% weight"}
- "Set roads to 40%" → {"action": "change_weight", "layerName": "Roads", "weight": 0.4, "message": "Changed Roads weight to 40%"}
- "Remove the traffic layer" → {"action": "delete_layer", "layerName": "Traffic", "weight": 0, "message": "Deleted Traffic layer"}
- "Hello" → {"action": "unknown", "layerName": "", "weight": 0, "message": "I can help you add, change, or delete layers. Try 'Add a parks layer with 15%'"}`;

export interface ChatAction {
  action: 'add_layer' | 'change_weight' | 'delete_layer' | 'unknown';
  layerName: string;
  weight: number;
  message: string;
}

export async function processChat(
  userMessage: string,
  currentLayers: { name: string; weight: number }[],
  apiKey: string,
  chatHistory: { role: string; text: string }[]
): Promise<ChatAction> {
  const layersContext = currentLayers
    .map(l => `${l.name}: ${Math.round(l.weight * 100)}%`)
    .join(', ');

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT + `\n\nCurrent layers: ${layersContext}` },
    ...chatHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.text,
    })),
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-mini-2025-08-07',
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI API error:', data);
      throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
    }
    const content = data.choices[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    return JSON.parse(jsonMatch[0]) as ChatAction;
  } catch (error) {
    console.error('OpenAI API error:', error);
    return {
      action: 'unknown',
      layerName: '',
      weight: 0,
      message: 'Sorry, I had trouble understanding that. Try "Add a parks layer with 15%"',
    };
  }
}
