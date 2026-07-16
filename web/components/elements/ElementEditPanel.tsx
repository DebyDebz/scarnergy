'use client';

import { useEffect, useState, useTransition } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { BuildingElement, Opening } from '@/lib/types';

// ── Field config (mirrors mobile DETAIL_FIELDS) ───────────────────────────────

type FieldType = 'select' | 'toggle' | 'number' | 'text';
interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  dependsOn?: { key: string; value: string | boolean };
  target?: 'element' | 'opening';
}

const DETAIL_FIELDS: Record<string, FieldDef[]> = {
  gevel: [
    { key: 'construction_type', label: 'Positie',      type: 'select',
      options: ['Voorgevel','Achtergevel','Linkergevel','Rechtergevel'] },
    { key: 'description',       label: 'Grenzt aan',   type: 'select',
      options: ['Buitenlucht','Kruipruimte','Aangrenzende onverwarmde ruimte','Aangrenzende verwarmde ruimte'] },
    { key: 'insulation_type',   label: 'Isolatietype', type: 'select',
      options: ['Glaswol','Spouwvulling','PUR','EPS','Geen'] },
    { key: 'rc_value',          label: 'Rc (m²K/W)',   type: 'number' },
    { key: 'rc_source',         label: 'Rc bron',      type: 'select',
      options: ['documented','observed','buildyear_forfait'] },
    { key: 'u_value',           label: 'U (W/m²K)',    type: 'number' },
    { key: 'dikte_vloerconstructie_mm', label: 'Dikte vloerconstructie (mm)', type: 'number' },
    { key: 'rekenhoogte_m_override',    label: 'Rekenhoogte override (m)',    type: 'number' },
    { key: 'notes',             label: 'Notities',     type: 'text' },
  ],
  transparant_deel: [
    { key: 'opening_type',          label: 'Type',                 type: 'select', target: 'opening',
      options: ['window','door','skylight'] },
    { key: 'frame_type',            label: 'Kozijn materiaal',     type: 'select', target: 'opening',
      options: ['Hout','Kunststof','Metaal','Hout/Kunststof'] },
    { key: 'glazing_type',          label: 'Beglazing',            type: 'select', target: 'opening',
      options: ['Enkel','Dubbel','HR+','HR++','Triple'] },
    { key: 'thermisch_onderbroken', label: 'Thermisch onderbroken',type: 'toggle', target: 'opening' },
    { key: 'has_shading',           label: 'Zonwering aanwezig',   type: 'toggle', target: 'opening' },
    { key: 'shading_type',          label: 'Type zonwering',       type: 'select', target: 'opening',
      options: ['Geen','Knikarmscherm','Uitvalscherm','Rolluik','Markies','Zonnecel'],
      dependsOn: { key: 'has_shading', value: true } },
    { key: 'overstek_m',            label: 'Overstek (m)',         type: 'number', target: 'opening' },
    { key: 'belemmering',           label: 'Belemmering',          type: 'text',   target: 'opening' },
    { key: 'u_glas',                label: 'U glas forfait (W/m²K)', type: 'number', target: 'opening' },
    { key: 'g_waarde',              label: 'g-waarde forfait',     type: 'number', target: 'opening' },
    { key: 'f_sh',                  label: 'F_sh schaduwfactor',   type: 'number', target: 'opening' },
    { key: 'notes',                 label: 'Notities',             type: 'text',   target: 'opening' },
  ],
  vloer: [
    { key: 'description',   label: 'Grenzt aan',    type: 'select',
      options: ['Kruipruimte','Buitenlucht','Aangrenzende onverwarmde ruimte'] },
    { key: 'insulation_type', label: 'Vloerisolatie', type: 'select',
      options: ['Geen','Glaswol','PUR','EPS','Kurk'] },
    { key: 'bodemisolatie', label: 'Bodemisolatie',  type: 'toggle' },
    { key: 'rc_value',      label: 'Rc (m²K/W)',     type: 'number' },
    { key: 'rc_source',     label: 'Rc bron',        type: 'select',
      options: ['documented','observed','buildyear_forfait'] },
    { key: 'notes',         label: 'Notities',       type: 'text' },
  ],
  dak: [
    { key: 'construction_type', label: 'Type dak',      type: 'select',
      options: ['HellendDak','PlatDak','Zadeldak'] },
    { key: 'tilt_deg',          label: 'Hoek (°)',       type: 'number' },
    { key: 'nokhoogte_m',       label: 'Nokhoogte (m)', type: 'number' },
    { key: 'insulation_type',   label: 'Isolatietype',   type: 'select',
      options: ['Glaswol','PUR','EPS','Geen'] },
    { key: 'rc_value',          label: 'Rc (m²K/W)',     type: 'number' },
    { key: 'rc_source',         label: 'Rc bron',        type: 'select',
      options: ['documented','observed','buildyear_forfait'] },
    { key: 'notes',             label: 'Notities',       type: 'text' },
  ],
  installatie: [
    { key: 'installation_type', label: 'Type installatie', type: 'select',
      options: ['Verwarming','Tapwater','Ventilatie','WarmtePomp','ZonnePanelen','ZonneCollectoren','Koeling'] },
    { key: 'brand',     label: 'Merk',      type: 'text' },
    { key: 'model_nr',  label: 'Model',     type: 'text' },
    { key: 'cv_klasse', label: 'CV klasse', type: 'select',
      options: ['CW3','CW4','CW5','CW6'],
      dependsOn: { key: 'installation_type', value: 'Verwarming' } },
    { key: 'fuel_type', label: 'Brandstof', type: 'select',
      options: ['Gas','Elektriciteit','Stadsverwarming','Biomassa'] },
    { key: 'efficiency',  label: 'Rendement',   type: 'number' },
    { key: 'capacity_kw', label: 'Vermogen (kW)', type: 'number' },
    { key: 'notes',       label: 'Notities',    type: 'text' },
  ],
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  element: BuildingElement | null;
  opening: Opening | null;
  onClose: () => void;
  onSaved: () => void;
}

type FormValues = Record<string, string | boolean | number>;

export function ElementEditPanel({ element, opening, onClose, onSaved }: Props) {
  const [values, setValues] = useState<FormValues>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Populate form from existing element + opening data
  useEffect(() => {
    if (!element) return;
    const fields = DETAIL_FIELDS[element.element_type] ?? [];
    const initial: FormValues = {};
    for (const f of fields) {
      const src = f.target === 'opening' ? opening : element;
      if (!src) continue;
      const v = (src as any)[f.key];
      if (v != null) initial[f.key] = v;
    }
    setValues(initial);
    setError(null);
  }, [element, opening]);

  const set = (key: string, val: string | boolean | number) =>
    setValues(prev => ({ ...prev, [key]: val }));

  // "Sla op als Standaard" (GAP W4): per-org default payload per element kind.
  // Applying merges the saved values into the form (only keys this form knows);
  // saving happens through the normal whitelisted PATCH, so the payload can
  // never write columns the API does not allow.
  const [defaultsMsg, setDefaultsMsg] = useState('');

  const applyDefault = async () => {
    if (!element) return;
    setDefaultsMsg('');
    const res = await fetch(`/api/element-defaults?kind=${element.element_type}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.payload == null) {
      setDefaultsMsg(res.ok ? 'Nog geen standaard opgeslagen voor dit type' : 'Standaard laden mislukt');
      return;
    }
    const known = new Set((DETAIL_FIELDS[element.element_type] ?? []).map(f => f.key));
    setValues(prev => {
      const merged = { ...prev };
      for (const [k, v] of Object.entries(data.payload as Record<string, unknown>)) {
        if (known.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
          merged[k] = v;
        }
      }
      return merged;
    });
    setDefaultsMsg('Standaard toegepast — controleer en sla op');
  };

  const saveAsDefault = async () => {
    if (!element) return;
    setDefaultsMsg('');
    const res = await fetch('/api/element-defaults', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ element_kind: element.element_type, payload: values }),
    });
    setDefaultsMsg(res.ok ? 'Opgeslagen als standaard voor de organisatie' : 'Standaard opslaan mislukt');
  };

  const handleSave = () => {
    if (!element) return;
    startTransition(async () => {
      setError(null);

      const fields = DETAIL_FIELDS[element.element_type] ?? [];
      const elementPayload: Record<string, unknown> = {};
      const openingPayload: Record<string, unknown> = {};

      for (const f of fields) {
        const v = values[f.key];
        if (v == null || v === '') continue;
        if (f.target === 'opening') openingPayload[f.key] = v;
        else elementPayload[f.key] = v;
      }

      const body: Record<string, unknown> = { ...elementPayload };
      if (Object.keys(openingPayload).length > 0) body.opening = openingPayload;

      const res = await fetch(`/api/elements/${element.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Save failed');
        return;
      }

      onSaved();
      onClose();
    });
  };

  if (!element) return null;

  const fields = DETAIL_FIELDS[element.element_type] ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">{element.name}</h2>
            <p className="text-xs text-gray-500 capitalize mt-0.5">{element.element_type}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto">
          {fields.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center italic">
              No qualitative fields defined for this element type.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {fields.map(field => {
                // Conditional visibility
                if (field.dependsOn) {
                  if (values[field.dependsOn.key] !== field.dependsOn.value) return null;
                }

                return (
                  <div key={field.key} className="flex items-center gap-3 px-5 py-3">
                    <label className="flex-1 text-sm text-gray-700 font-medium" htmlFor={field.key}>
                      {field.label}
                    </label>

                    {field.type === 'toggle' ? (
                      <button
                        id={field.key}
                        role="switch"
                        aria-checked={!!values[field.key]}
                        onClick={() => set(field.key, !values[field.key])}
                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors
                          ${values[field.key] ? 'bg-indigo-600' : 'bg-gray-200'}`}
                      >
                        <span className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform
                          ${values[field.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>

                    ) : field.type === 'select' && field.options ? (
                      <select
                        id={field.key}
                        value={(values[field.key] as string) ?? ''}
                        onChange={e => set(field.key, e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px]"
                      >
                        <option value="">— selecteer —</option>
                        {field.options.map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>

                    ) : (
                      <input
                        id={field.key}
                        type={field.type === 'number' ? 'number' : 'text'}
                        step={field.type === 'number' ? '0.01' : undefined}
                        value={values[field.key] != null ? String(values[field.key]) : ''}
                        onChange={e => set(field.key, field.type === 'number' ? parseFloat(e.target.value) || '' : e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 max-w-[180px] w-full"
                        placeholder={field.type === 'number' ? '0.00' : '…'}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 shrink-0 space-y-2">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={applyDefault}
              className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Standaard toepassen
            </button>
            <button
              onClick={saveAsDefault}
              className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Sla op als standaard
            </button>
            {defaultsMsg && <span className="text-gray-400">{defaultsMsg}</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
