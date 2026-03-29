import type { RewardPattern } from '../patterns';

const SYSTEM_PROMPT = `You are an assistant for an MDP grid visualization tool that helps manage layers.
The grid is 20 columns x 10 rows with reward values from 0 to 100.

Available actions:
- add_layer: Create a new layer with a name and weight (0.0 to 1.0). Optionally include a "pattern" to define the reward distribution.
- change_weight: Modify an existing layer's weight
- delete_layer: Remove a layer by name
- edit_rewards: Change the reward pattern of an existing layer. Requires "layerName" and "pattern".
- rename_layer: Rename an existing layer. "layerName" is the current name, "newName" is the new name.

You must respond with valid JSON only, no markdown or explanation:
{
  "action": "add_layer" | "change_weight" | "delete_layer" | "edit_rewards" | "rename_layer" | "unknown",
  "layerName": "string",
  "weight": number (0.0 to 1.0, for add_layer and change_weight),
  "message": "string (friendly response to show the user)",
  "pattern": { ... } (optional, for add_layer and edit_rewards),
  "newName": "string (only for rename_layer)"
}

Pattern types (use in the "pattern" field):
- gradient: {"type":"gradient","direction":"left-to-right"|"right-to-left"|"top-to-bottom"|"bottom-to-top","min":0-100,"max":0-100}
- uniform: {"type":"uniform","value":0-100}
- radial: {"type":"radial","centerRow":0-9,"centerCol":0-19,"innerValue":0-100,"outerValue":0-100}
- noise: {"type":"noise","min":0-100,"max":0-100}
- stripe: {"type":"stripe","direction":"horizontal"|"vertical","stripeValue":0-100,"backgroundValue":0-100,"stripeWidth":1-5,"spacing":1-10}
- region: {"type":"region","region":"left"|"right"|"top"|"bottom"|"center"|"corners"|"edges","regionValue":0-100,"backgroundValue":0-100}

Examples:
- "Add a hospital layer with 20% weight" → {"action":"add_layer","layerName":"Hospital","weight":0.2,"message":"Added Hospital layer with 20% weight"}
- "Add a mountain layer with high values on the left at 15%" → {"action":"add_layer","layerName":"Mountain","weight":0.15,"pattern":{"type":"region","region":"left","regionValue":90,"backgroundValue":20},"message":"Added Mountain layer with high rewards on the left"}
- "Make roads have a gradient from top to bottom" → {"action":"edit_rewards","layerName":"Roads","weight":0,"pattern":{"type":"gradient","direction":"top-to-bottom","min":90,"max":10},"message":"Updated Roads with a top-to-bottom gradient"}
- "Set traffic to uniform 50" → {"action":"edit_rewards","layerName":"Traffic","weight":0,"pattern":{"type":"uniform","value":50},"message":"Set Traffic to uniform value of 50"}
- "Set roads to 40%" → {"action":"change_weight","layerName":"Roads","weight":0.4,"message":"Changed Roads weight to 40%"}
- "Remove the traffic layer" → {"action":"delete_layer","layerName":"Traffic","weight":0,"message":"Deleted Traffic layer"}
- "Rename roads to Highways" → {"action":"rename_layer","layerName":"Roads","weight":0,"newName":"Highways","message":"Renamed Roads to Highways"}
- "Hello" → {"action":"unknown","layerName":"","weight":0,"message":"I can help manage layers: add, remove, change weights, or edit reward patterns. Try 'Add a parks layer with 15%' or 'Make roads have high values on the left'"}`;

export interface ChatAction {
  action: 'add_layer' | 'change_weight' | 'delete_layer' | 'edit_rewards' | 'rename_layer' | 'unknown';
  layerName: string;
  weight: number;
  message: string;
  pattern?: RewardPattern;
  newName?: string;
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
