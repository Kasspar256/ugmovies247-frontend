import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderOpen,
  Pencil,
  Tv2,
  X,
} from 'lucide-react';
import type { AdminCategory } from '@/types/admin';
import type { Movie } from '@/types/movie';
import { isIndianCatalogMovie, isIndianSectionName } from '@/lib/regionalCatalog';
import {
  Card,
  FieldLabel,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/admin/controlCenterFields';
import type { CategoryDraft } from '@/components/admin/controlCenterUtils';

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function includesIgnoreCase(entries: string[] | undefined, value: string) {
  const target = value.trim().toLowerCase();
  return (entries || []).some((entry) => entry.trim().toLowerCase() === target);
}

function getCategoryItems(category: AdminCategory, movies: Movie[]) {
  const categorySlug = slugify(category.name);

  return movies.filter((movie) => {
    if (isIndianSectionName(category.name)) {
      return isIndianCatalogMovie(movie);
    }

    if (category.type === 'genre') {
      return includesIgnoreCase(movie.genres, category.name);
    }

    if (categorySlug === 'trending-on-tiktok') {
      return Boolean(movie.is_trending_tiktok) || includesIgnoreCase(movie.category, category.name);
    }

    return includesIgnoreCase(movie.category, category.name);
  });
}

function getCategoryLabel(category: AdminCategory) {
  return category.displayLabel || category.name;
}

function getCategoryTypeLabel(category: AdminCategory) {
  if (category.type === 'home_row') {
    return 'Homepage';
  }

  if (category.type === 'genre') {
    return 'Genre';
  }

  return 'Category';
}

export function AdminCategoriesTab({
  categories,
  movies,
  categoryDraft,
  onChangeDraft,
  onResetDraft,
  onEditCategory,
  onSaveCategory,
  onDeleteCategory,
  onMoveHomeCategory,
  onToggleCategoryVisibility,
  onRemoveMovieFromCategory,
  actionBusy,
}: {
  categories: AdminCategory[];
  movies: Movie[];
  categoryDraft: CategoryDraft;
  onChangeDraft: (nextDraft: CategoryDraft) => void;
  onResetDraft: () => void;
  onEditCategory: (category: AdminCategory) => void;
  onSaveCategory: () => void;
  onDeleteCategory: (category: AdminCategory) => void;
  onMoveHomeCategory: (categoryId: string, direction: -1 | 1) => void;
  onToggleCategoryVisibility: (category: AdminCategory) => void;
  onRemoveMovieFromCategory: (category: AdminCategory, movie: Movie) => void;
  actionBusy: boolean;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState('');

  const homeCategories = useMemo(
    () =>
      categories
        .filter((category) => category.type === 'home_row')
        .slice()
        .sort(
          (left, right) =>
            (left.homeOrder ?? Number.MAX_SAFE_INTEGER) -
              (right.homeOrder ?? Number.MAX_SAFE_INTEGER) ||
            left.name.localeCompare(right.name)
        ),
    [categories]
  );

  const allCategories = useMemo(
    () =>
      categories
        .filter((category) => category.type !== 'home_row')
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [categories]
  );

  useEffect(() => {
    if (categoryDraft.id) {
      setSelectedCategoryId(categoryDraft.id);
      return;
    }

    const categoryStillExists = categories.some((category) => category.id === selectedCategoryId);

    if (!categoryStillExists) {
      setSelectedCategoryId(homeCategories[0]?.id || allCategories[0]?.id || '');
    }
  }, [allCategories, categories, categoryDraft.id, homeCategories, selectedCategoryId]);

  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) || homeCategories[0] || allCategories[0] || null;
  const selectedItems = useMemo(
    () => (selectedCategory ? getCategoryItems(selectedCategory, movies) : []),
    [movies, selectedCategory]
  );

  const renderCategoryRow = (
    category: AdminCategory,
    options?: {
      showReorder?: boolean;
      index?: number;
      total?: number;
    }
  ) => {
    const itemCount = getCategoryItems(category, movies).length;
    const isSelected = selectedCategory?.id === category.id;

    return (
      <div
        key={category.id}
        className={`rounded-2xl border p-4 transition-colors ${
          isSelected
            ? 'border-[#D90429]/45 bg-[#D90429]/10'
            : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/25'
        }`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <button
            type="button"
            onClick={() => setSelectedCategoryId(category.id)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-bold text-white">{getCategoryLabel(category)}</div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/60">
                {getCategoryTypeLabel(category)}
              </span>
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                  category.isVisible
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                    : 'border-white/10 bg-white/5 text-white/45'
                }`}
              >
                {category.isVisible ? 'Visible' : 'Hidden'}
              </span>
            </div>
            <div className="mt-2 text-xs leading-6 text-white/55">
              {category.description || 'Open this category to browse and manage assigned titles.'}
            </div>
            <div className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/42">
              {itemCount} title{itemCount === 1 ? '' : 's'}
            </div>
          </button>

          <div className="flex flex-wrap gap-2">
            {options?.showReorder && (
              <>
                <button
                  type="button"
                  disabled={actionBusy || (options.index ?? 0) === 0}
                  onClick={() => onMoveHomeCategory(category.id, -1)}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white disabled:opacity-35"
                >
                  <ArrowUp size={13} />
                  Up
                </button>
                <button
                  type="button"
                  disabled={actionBusy || (options.index ?? 0) === (options.total ?? 1) - 1}
                  onClick={() => onMoveHomeCategory(category.id, 1)}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white disabled:opacity-35"
                >
                  <ArrowDown size={13} />
                  Down
                </button>
              </>
            )}
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => onToggleCategoryVisibility(category)}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white disabled:opacity-50"
            >
              {category.isVisible ? <EyeOff size={13} /> : <Eye size={13} />}
              {category.isVisible ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCategoryId(category.id);
                onEditCategory(category);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white"
            >
              <Pencil size={13} />
              Edit
            </button>
            {!category.isSystem && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => onDeleteCategory(category)}
                className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-red-100 disabled:opacity-50"
              >
                <X size={13} />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.02fr_1.3fr]">
      <div className="space-y-6">
        <Card
          title={categoryDraft.id ? 'Edit Category' : 'Create Category'}
          description="Edit display labels, visibility, and behavior for homepage rows or general browse categories."
        >
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Name</FieldLabel>
                <TextInput
                  value={categoryDraft.name}
                  onChange={(event) =>
                    onChangeDraft({
                      ...categoryDraft,
                      name: event.target.value,
                      displayLabel:
                        categoryDraft.displayLabel || event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <FieldLabel>Display Label</FieldLabel>
                <TextInput
                  value={categoryDraft.displayLabel}
                  onChange={(event) =>
                    onChangeDraft({
                      ...categoryDraft,
                      displayLabel: event.target.value,
                    })
                  }
                  placeholder="How this category should appear in admin/home"
                />
              </div>
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
            <div className="grid gap-4 md:grid-cols-2">
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
              <div>
                <FieldLabel>Visibility</FieldLabel>
                <button
                  type="button"
                  onClick={() =>
                    onChangeDraft({
                      ...categoryDraft,
                      isVisible: !categoryDraft.isVisible,
                    })
                  }
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm ${
                    categoryDraft.isVisible
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                      : 'border-white/10 bg-[#0C1017] text-white/70'
                  }`}
                >
                  <span>{categoryDraft.isVisible ? 'Visible on surfaces' : 'Hidden from surfaces'}</span>
                  {categoryDraft.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
              </div>
            </div>
            {categoryDraft.type === 'home_row' && (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs leading-6 text-white/55">
                Homepage categories keep a persistent row order. Use the controls in the Home Page Categories list below to move them up or down.
              </div>
            )}
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
          title="Home Page Categories"
          description="Manage only the rows that are manually controlled on the homepage. Open any row to inspect its titles, reorder it, or hide it."
        >
          <div className="space-y-3">
            {homeCategories.map((category, index) =>
              renderCategoryRow(category, {
                showReorder: true,
                index,
                total: homeCategories.length,
              })
            )}
          </div>
        </Card>

        <Card
          title="All Categories"
          description="Browse the wider taxonomy for the catalog. Open any category to see its assigned movies and series."
        >
          <div className="space-y-3">
            {allCategories.map((category) => renderCategoryRow(category))}
          </div>
        </Card>
      </div>

      <Card
        title={selectedCategory ? getCategoryLabel(selectedCategory) : 'Category Content'}
        description={
          selectedCategory
            ? `Open view for ${getCategoryLabel(selectedCategory)}. Browse assigned titles, remove anything that no longer belongs here, or jump straight into editing the title itself.`
            : 'Select a category to inspect its movies and series.'
        }
      >
        {selectedCategory ? (
          <div className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#D90429]/25 bg-[#D90429]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#FFD7DF]">
                  {getCategoryTypeLabel(selectedCategory)}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/70">
                  {selectedItems.length} title{selectedItems.length === 1 ? '' : 's'}
                </span>
                <span
                  className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                    selectedCategory.isVisible
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-white/45'
                  }`}
                >
                  {selectedCategory.isVisible ? 'Visible' : 'Hidden'}
                </span>
              </div>
              <div className="mt-3 text-sm leading-7 text-white/65">
                {selectedCategory.description ||
                  'This category is ready for management. Use the cards below to remove misplaced titles or jump into editing them.'}
              </div>
            </div>

            {selectedItems.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {selectedItems.map((item) => {
                  const isSeries = item.contentType === 'series';

                  return (
                    <div
                      key={`${selectedCategory.id}-${item.id}`}
                      className="overflow-hidden rounded-3xl border border-white/10 bg-black/20"
                    >
                      <div className="aspect-[16/9] overflow-hidden bg-[#0C1017]">
                        {item.poster ? (
                          <img
                            src={item.poster}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/28">
                            {isSeries ? <Tv2 size={34} /> : <FolderOpen size={34} />}
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 p-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/70">
                              {isSeries ? 'Series' : 'Movie'}
                            </span>
                            {item.vj && (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
                                VJ {item.vj}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-sm font-bold leading-6 text-white">
                            {item.title}
                          </div>
                        </div>

                        <div className="line-clamp-3 text-xs leading-6 text-white/55">
                          {item.description || item.overview || 'No description available.'}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <Link
                            href={isSeries ? `/admin/series/${item.id}` : `/admin/movies/${item.id}`}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-white/10"
                          >
                            <Pencil size={13} />
                            Edit Title
                          </Link>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => onRemoveMovieFromCategory(selectedCategory, item)}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-red-100 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                          >
                            <X size={13} />
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 px-5 py-10 text-center text-sm leading-7 text-white/50">
                No movies or series are currently assigned to this category.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 px-5 py-10 text-center text-sm leading-7 text-white/50">
            Select a category from the left to open its content.
          </div>
        )}
      </Card>
    </div>
  );
}
