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
      title="New patient"
      description="Add someone you will prescribe home exercises to."
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
