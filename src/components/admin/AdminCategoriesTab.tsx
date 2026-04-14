import type { AdminCategory } from '@/types/admin';
import { Card, FieldLabel, SelectInput, TextArea, TextInput } from '@/components/admin/controlCenterFields';
import type { CategoryDraft } from '@/components/admin/controlCenterUtils';

export function AdminCategoriesTab({
  categories,
  categoryDraft,
  onChangeDraft,
  onResetDraft,
  onEditCategory,
  onSaveCategory,
  onDeleteCategory,
  actionBusy,
}: {
  categories: AdminCategory[];
  categoryDraft: CategoryDraft;
  onChangeDraft: (nextDraft: CategoryDraft) => void;
  onResetDraft: () => void;
  onEditCategory: (category: AdminCategory) => void;
  onSaveCategory: () => void;
  onDeleteCategory: (category: AdminCategory) => void;
  actionBusy: boolean;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.2fr]">
      <Card
        title={categoryDraft.id ? 'Edit Category' : 'Create Category'}
        description="Categories stay reusable across movies and series, and can be changed anytime later."
      >
        <div className="space-y-4">
          <div>
            <FieldLabel>Name</FieldLabel>
            <TextInput
              value={categoryDraft.name}
              onChange={(event) =>
                onChangeDraft({
                  ...categoryDraft,
                  name: event.target.value,
                })
              }
            />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <TextArea
              rows={4}
              value={categoryDraft.description}
              onChange={(event) =>
                onChangeDraft({
                  ...categoryDraft,
                  description: event.target.value,
                })
              }
            />
          </div>
          <div>
            <FieldLabel>Type</FieldLabel>
            <SelectInput
              value={categoryDraft.type}
              onChange={(event) =>
                onChangeDraft({
                  ...categoryDraft,
                  type: event.target.value as AdminCategory['type'],
                })
              }
            >
              <option value="custom">Custom</option>
              <option value="genre">Genre</option>
              <option value="home_row">Home Row</option>
            </SelectInput>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onResetDraft}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white"
            >
              Reset
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={onSaveCategory}
              className="inline-flex items-center gap-2 rounded-full bg-[#D90429] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white disabled:opacity-60"
            >
              {categoryDraft.id ? 'Save Category' : 'Create Category'}
            </button>
          </div>
        </div>
      </Card>

      <Card
        title="Category Management"
        description="Delete with care: linked movie records will be updated so they no longer reference the removed category."
      >
        <div className="space-y-3">
          {categories.map((category) => (
            <div key={category.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">{category.name}</div>
                  <div className="mt-2 text-xs text-white/50">
                    {category.type}
                    {category.isSystem ? ' | system seed' : ''}
                  </div>
                  {category.description && (
                    <div className="mt-2 text-xs leading-6 text-white/55">{category.description}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onEditCategory(category)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => onDeleteCategory(category)}
                    className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
