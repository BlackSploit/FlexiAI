import { ResponsiveDialog } from "@/components/responsive-dialog";

import { PatientForm } from "./patient-form";

interface NewPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id?: string) => void;
};

export const NewPatientDialog = ({
  open,
  onOpenChange,
  onCreated,
}: NewPatientDialogProps) => {
  return (
    <ResponsiveDialog
      title="New Patient"
      description="Add a patient to your list"
      open={open}
      onOpenChange={onOpenChange}
    >
      <PatientForm
        onSuccess={(id) => {
          onOpenChange(false);
          onCreated?.(id);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
};
