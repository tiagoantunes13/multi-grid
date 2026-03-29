# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` - Start development server with HMR
- `npm run build` - TypeScript check and production build
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

## Tech Stack

- React 19 with TypeScript
- Vite for bundling
- Tailwind CSS for styling
- ESLint with React hooks and refresh plugins

## Architecture

This is a single-component React application implementing a Multi-Grid Markov Decision Process (MDP) visualization and solver.

### Core Component: MultiGridMDP

The main component (`src/MultiGridMDP.tsx`) implements:

1. **Reward Grid System**: Multiple weighted layers (roads, scenic views, traffic, terrain, safety) that combine into a 20x10 grid of reward values

2. **Policy Iteration Algorithm**:
   - `improvePolicy()` - Computes optimal action (↑↓←→) for each cell based on value function
   - `evaluatePolicy()` - Updates value function based on current policy
   - `performPolicyIteration()` - Alternates between evaluation and improvement until convergence

3. **Interactive Features**:
   - Click any cell to set it as the goal state
   - Adjust layer weights with sliders (weights should sum to 1.0)
   - Toggle layer visibility with eye button
   - Hover over layer names to preview individual layer rewards
   - Edit layer rewards by clicking pencil button, then paint cells (left-click = 90, right-click = 10)
   - Chat interface for layer management (powered by OpenAI GPT-5.1 Mini)

4. **MDP Parameters**:
   - Discount factor (gamma): Controls how much future rewards are valued
   - Speed: Controls iteration rate for visualization

### Chat Commands

The chat uses OpenAI GPT-5.1 Mini to parse user intent and return structured JSON actions. Users must enter their own API key at runtime (no key is stored in the codebase). Supported commands:

- **Add layer**: "Add a [name] layer with [X]% weight"
  - Extracts name from input, any name works
  - Auto-rebalances other layer weights to sum to 1.0

- **Change weight**: "Set [layer name] weight to [X]%" or "Change [layer name] to [X]%"
  - Finds layer by name match
  - Does not auto-rebalance other weights

### Layer Reward Patterns

`generateMockRewards(description)` creates reward grids based on keywords:
- `road` - Vertical and horizontal road lines (high values)
- `beach`/`scenic` - Gradient from top (high) to bottom (low)
- `traffic` - Center-focused with noise
- `elevation`/`terrain` - Distance from center
- `safety`/`crime` - Based on proximity to roads and corners
- Default (unrecognized) - Big cross pattern through center

### State Management

- All state is in-memory (useState) - no persistence
- Refreshing the page resets everything to initial values
