"use client";

import { BulkActionBar } from "@/components/products/BulkActionBar";
import { ImportPreviewDialog } from "@/components/products/ImportPreviewDialog";
import { ProductFilters } from "@/components/products/ProductFilters";
import { ProductFormDialog } from "@/components/products/ProductFormDialog";
import { ProductsHeader } from "@/components/products/ProductsHeader";
import { ProductTable } from "@/components/products/ProductTable";
import { productFilterView, useProductFilters } from "@/components/products/useProductFilters";
import { useProductForm } from "@/components/products/useProductForm";
import { useProductImport } from "@/components/products/useProductImport";
import { useProducts } from "@/components/products/useProducts";
import { useProductActions } from "@/components/products/useProductActions";
import { useProductSelection } from "@/components/products/useProductSelection";
import { ReplaceProductDialog } from "@/components/products/ReplaceProductDialog";

// ─── Page ──────────────────────────────────────────────────────────────
// Product list (server-side filters incl. status ใช้งาน / ปิดใช้งาน, sort, pagination; bulk delete / disable; "⋯" row menu), add/edit dialog,
// Excel / CSV import with diff preview, export and import template.
export default function ProductsPage() {
  const filterControls = useProductFilters();
  const data = useProducts(filterControls.query);
  const filters = productFilterView(filterControls, data.products, data.total);
  const selection = useProductSelection(filters.paginatedList);
  const productForm = useProductForm(data, selection.setExpandedRows);
  const productImport = useProductImport(data.ensureCatalog, data.loadData);
  const actions = useProductActions(data, {
    onDuplicate: productForm.handleOpenDuplicate,
    onDeleted: (id) => selection.forget([id]),
  });

  return (
    <div className="page-shell">
      <ProductsHeader
        categories={data.categories}
        suppliers={data.suppliers}
        onImportFile={productImport.handleFileSelectForImport}
        onSupplierImported={() => {
          data.loadData();
          void data.reloadSuppliers();
        }}
        onAdd={productForm.handleOpenAdd}
      />

      {/* Filter Toolbar */}
      <ProductFilters f={filters} categories={data.categories} suppliers={data.suppliers} totalCount={data.allCount} inactiveCount={data.inactiveCount} />

      <BulkActionBar data={data} sel={selection} />

      {/* Table */}
      <ProductTable data={data} f={filters} sel={selection} onEdit={productForm.handleOpenEdit} actions={actions} />

      {/* Dialog */}
      <ProductFormDialog state={productForm} products={data.catalog} onNeedCatalog={data.ensureCatalog} categories={data.categories} suppliers={data.suppliers} reloadCategories={data.reloadCategories} reloadSuppliers={data.reloadSuppliers} />

      {/* Delete a used product with a replacement */}
      <ReplaceProductDialog {...actions.replaceDialog} />

      {/* ─── EXCEL IMPORT PREVIEW DIALOG (SMART SELECTIVE DIFF & CHUNKING) ─── */}
      <ImportPreviewDialog state={productImport} />
    </div>
  );
}
