"use client";

import { BulkActionBar } from "@/components/products/BulkActionBar";
import { ImportPreviewDialog } from "@/components/products/ImportPreviewDialog";
import { ProductFilters } from "@/components/products/ProductFilters";
import { ProductFormDialog } from "@/components/products/ProductFormDialog";
import { ProductsHeader } from "@/components/products/ProductsHeader";
import { ProductTable } from "@/components/products/ProductTable";
import { useProductFilters } from "@/components/products/useProductFilters";
import { useProductForm } from "@/components/products/useProductForm";
import { useProductImport } from "@/components/products/useProductImport";
import { useProducts } from "@/components/products/useProducts";
import { useProductSelection } from "@/components/products/useProductSelection";

// ─── Page ──────────────────────────────────────────────────────────────
// Product list (filters, sort, pagination, bulk delete), add/edit dialog,
// Excel / CSV import with diff preview, export and import template.
export default function ProductsPage() {
  const data = useProducts();
  const filters = useProductFilters(data.products, data.allPackaging);
  const selection = useProductSelection(filters.paginatedList);
  const productForm = useProductForm(data, selection.setExpandedRows);
  const productImport = useProductImport(data.products, data.loadData);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <ProductsHeader products={data.products} onImportFile={productImport.handleFileSelectForImport} onAdd={productForm.handleOpenAdd} />

      {/* Filter Toolbar */}
      <ProductFilters f={filters} categories={data.categories} suppliers={data.suppliers} totalCount={data.products.length} />

      <BulkActionBar data={data} sel={selection} />

      {/* Table */}
      <ProductTable data={data} f={filters} sel={selection} onEdit={productForm.handleOpenEdit} />

      {/* Dialog */}
      <ProductFormDialog state={productForm} products={data.products} categories={data.categories} suppliers={data.suppliers} />

      {/* ─── EXCEL IMPORT PREVIEW DIALOG (SMART SELECTIVE DIFF & CHUNKING) ─── */}
      <ImportPreviewDialog state={productImport} />
    </div>
  );
}
