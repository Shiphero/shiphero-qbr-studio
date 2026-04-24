import { Shipment } from '../types/index';
import { PriorPeriodSummary, PeriodDelta } from './periodComparison';

export interface RecommendedAction {
  id: string;
  category: 'cost' | 'carrier' | 'network' | 'inventory' | 'growth' | 'general';
  priority: 'high' | 'medium' | 'low';
  title: string;
  body: string;
  /** If true, the action was edited by a CSM and should not be auto-regenerated. */
  edited?: boolean;
}

// ── Auto-generation ───────────────────────────────────────────────────────────

export function generateRecommendedActions(
  shipments: Shipment[],
  priorPeriod?: PriorPeriodSummary,
  delta?: PeriodDelta,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  if (shipments.length === 0) return defaultActions();

  // ── Carrier concentration ───────────────────────────────────────────────────
  const carrierTotals: Record<string, number> = {};
  let totalSpend = 0;
  let totalWeight = 0;
  const zoneCounts: Record<string, number> = {};
  const stateCounts: Record<string, number> = {};

  for (const s of shipments) {
    const c = s.carrier || 'Unknown';
    carrierTotals[c] = (carrierTotals[c] ?? 0) + s.labelCost;
    totalSpend += s.labelCost;
    totalWeight += s.weight;
    stateCounts[s.state] = (stateCounts[s.state] ?? 0) + 1;
  }

  const avgWeight = shipments.length > 0 ? totalWeight / shipments.length : 0;

  // Top carrier concentration
  const sortedCarriers = Object.entries(carrierTotals).sort((a, b) => b[1] - a[1]);
  if (sortedCarriers.length >= 2) {
    const topCarrierPct = (sortedCarriers[0][1] / totalSpend) * 100;
    if (topCarrierPct > 75) {
      actions.push({
        id: 'carrier-concentration',
        category: 'carrier',
        priority: 'high',
        title: 'Reduce carrier concentration risk',
        body: `${Math.round(topCarrierPct)}% of shipping spend is concentrated with ${sortedCarriers[0][0]}. Consider diversifying to a secondary carrier for redundancy and negotiating leverage.`,
      });
    }
  }

  // ── Average weight ──────────────────────────────────────────────────────────
  if (avgWeight > 5) {
    actions.push({
      id: 'weight-optimization',
      category: 'cost',
      priority: 'medium',
      title: 'Evaluate weight-based carrier optimization',
      body: `Average shipment weight is ${avgWeight.toFixed(1)} lbs. At this weight profile, regional carriers or dimensional weight negotiations with your primary carrier could yield meaningful per-shipment savings.`,
    });
  }

  // ── Geographic distribution ─────────────────────────────────────────────────
  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s]) => s);

  if (topStates.length > 0) {
    const topStatesPct = topStates.reduce((sum, s) => sum + (stateCounts[s] ?? 0), 0) / shipments.length * 100;
    if (topStatesPct > 40) {
      actions.push({
        id: 'network-expansion',
        category: 'network',
        priority: 'medium',
        title: 'Review warehouse proximity to high-volume regions',
        body: `${Math.round(topStatesPct)}% of shipments are destined for ${topStates.join(', ')}. Adding or leveraging a fulfillment node closer to these markets could reduce average zone and transit time.`,
      });
    }
  }

  // ── QoQ deltas ──────────────────────────────────────────────────────────────
  if (delta) {
    if (delta.avgLabelCostPct > 10) {
      actions.push({
        id: 'cost-increase',
        category: 'cost',
        priority: 'high',
        title: 'Investigate shipping cost increase',
        body: `Average label cost increased ${delta.avgLabelCostPct.toFixed(1)}% vs. the prior period. Review carrier surcharge changes, weight profile shifts, and zone distribution to identify root causes.`,
      });
    }
    if (delta.totalShipmentsPct > 20) {
      actions.push({
        id: 'volume-growth',
        category: 'growth',
        priority: 'low',
        title: 'Plan capacity for continued volume growth',
        body: `Shipment volume grew ${delta.totalShipmentsPct.toFixed(1)}% vs. prior period. Proactive rate negotiations and capacity planning with carriers is recommended before peak season.`,
      });
    }
    if (delta.totalShipmentsPct < -15) {
      actions.push({
        id: 'volume-decline',
        category: 'growth',
        priority: 'high',
        title: 'Address shipment volume decline',
        body: `Shipment volume declined ${Math.abs(delta.totalShipmentsPct).toFixed(1)}% vs. prior period. Investigate order fulfillment rates, stockouts, and demand trends to identify contributing factors.`,
      });
    }
  }

  // Always include a general action if we have few
  if (actions.length < 2) {
    actions.push(...defaultActions());
  }

  return actions.slice(0, 6);
}

function defaultActions(): RecommendedAction[] {
  return [
    {
      id: 'rate-review',
      category: 'cost',
      priority: 'medium',
      title: 'Schedule annual carrier rate review',
      body: 'Request updated rate cards from all active carriers. Compare against current ShipHero negotiated rates to identify savings opportunities.',
    },
    {
      id: 'reporting-cadence',
      category: 'general',
      priority: 'low',
      title: 'Establish monthly reporting cadence',
      body: 'Set up recurring QBR touchpoints to review shipping performance trends, anomalies, and optimization opportunities with the ShipHero CSM team.',
    },
  ];
}
