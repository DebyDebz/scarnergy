import type { DataSource } from '@/lib/dataSource/DataSourceContext';
import type { OrganisationService, BuildingService, ContactService } from './types';

import { scanergyOrganisationService } from './scanergy/organisations';
import { scanergyBuildingService } from './scanergy/buildings';
import { scanergyContactService } from './scanergy/contacts';

import { appsheetOrganisationService } from './appsheet/organisations';
import { appsheetBuildingService } from './appsheet/buildings';
import { appsheetContactService } from './appsheet/contacts';

export function getOrganisationService(source: DataSource): OrganisationService {
  return source === 'appsheet' ? appsheetOrganisationService : scanergyOrganisationService;
}

export function getBuildingService(source: DataSource): BuildingService {
  return source === 'appsheet' ? appsheetBuildingService : scanergyBuildingService;
}

export function getContactService(source: DataSource): ContactService {
  return source === 'appsheet' ? appsheetContactService : scanergyContactService;
}

export { DataSourceBlockedError } from './types';
export type { OrganisationService, BuildingService, ContactService } from './types';
