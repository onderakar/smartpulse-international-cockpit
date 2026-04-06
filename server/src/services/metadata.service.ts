import { PrismaClient } from '@prisma/client';
import { parseMultiBatteryTechParams } from '../utils/techParamsParser';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

export class MetadataService {
    /**
     * Syncs the Technical_Parameters.csv into the Database.
     * Maps each plant column to an Asset, and the rows to AttributeMappings.
     */
    static async syncTechParamsToDb(csvContent: string) {
        const parsed = parseMultiBatteryTechParams(csvContent);
        const { plantIds, rawByPlant } = parsed;

        for (const plantIdStr of plantIds) {
            const plantId = parseInt(plantIdStr, 10);

            // Create or find Asset
            const asset = await prisma.asset.upsert({
                where: { id: plantId }, // By ID directly since plantId maps directly to our legacy structures
                update: {
                    name: `GCP_${plantId}`,
                    type: 'BATTERY'
                },
                create: {
                    id: plantId,
                    name: `GCP_${plantId}`,
                    type: 'BATTERY',
                },
            });

            // Upsert Attribute Mappings
            const attributes = rawByPlant[plantIdStr];
            for (const [key, value] of Object.entries(attributes)) {
                if (value === undefined || value === null || value === '') continue;

                await prisma.attributeMapping.upsert({
                    where: {
                        assetId_attributeKey: {
                            assetId: asset.id,
                            attributeKey: key,
                        }
                    },
                    update: {
                        attributeVal: String(value),
                    },
                    create: {
                        assetId: asset.id,
                        attributeKey: key,
                        attributeVal: String(value),
                        dataSource: 'tech_params_csv'
                    }
                });
            }
        }

        return parsed;
    }

    /**
     * Generic Priority Framework Initialization Helper
     * Links an asset, a metric (e.g. BAP, OSOS_PRODUCTION), and an ordered list of fallback sources (e.g. ['SCADA', 'TSO'])
     */
    static async setFallbackPriorities(assetId: number, metricTypeName: string, sourceNamesOrdered: string[]) {
        const metricType = await prisma.metricType.upsert({
            where: { name: metricTypeName },
            update: {},
            create: { name: metricTypeName, unit: 'MW' }
        });

        await prisma.sourcePriorityRule.deleteMany({
            where: { assetId, metricTypeId: metricType.id }
        });

        for (let i = 0; i < sourceNamesOrdered.length; i++) {
            const sourceName = sourceNamesOrdered[i];
            const source = await prisma.dataSource.upsert({
                where: { name: sourceName },
                update: {},
                create: { name: sourceName }
            });

            await prisma.sourcePriorityRule.create({
                data: {
                    assetId,
                    metricTypeId: metricType.id,
                    dataSourceId: source.id,
                    priorityRank: i + 1
                }
            });
        }
    }

    static async getAssetAttributes(assetId: number): Promise<Record<string, string>> {
        const attrs = await prisma.attributeMapping.findMany({
            where: { assetId }
        });

        const mapped: Record<string, string> = {};
        for (const attr of attrs) {
            mapped[attr.attributeKey] = attr.attributeVal;
        }
        return mapped;
    }
}
