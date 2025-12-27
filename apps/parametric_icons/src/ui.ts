/**
 * UI components via factory functions from @parametric-portal/components.
 * Uses algorithmic scaling from schema.ts (scale 1-10, density 0.5-2, baseUnit rem).
 */
import { createControls } from '@parametric-portal/components/controls';
import { createData } from '@parametric-portal/components/data';
import { createElements } from '@parametric-portal/components/elements';
import { createFeedback } from '@parametric-portal/components/feedback';
import { createIcons } from '@parametric-portal/components/icons';
import { createInputBars } from '@parametric-portal/components/input-bar';
import { createNavigation } from '@parametric-portal/components/navigation';
import { createOverlays } from '@parametric-portal/components/overlays';
import { createSelection } from '@parametric-portal/components/selection';
import { createUpload } from '@parametric-portal/components/upload';
import { createUtility } from '@parametric-portal/components/utility';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    algo: {
        iconGapMul: 3,
    },
    animation: {
        delay: 0,
        duration: 200,
        easing: 'ease-out',
        enabled: true,
    },
    behavior: {
        disabled: false,
        loading: false,
        readonly: false,
    },
    feedback: {
        autoDismiss: true,
        dismissible: true,
        duration: 5000,
    },
    iconScale: {
        baseUnit: 0.25,
        density: 1,
        radiusMultiplier: 0.25,
        scale: 2,
    },
    scale: {
        baseUnit: 0.25,
        density: 1,
        radiusMultiplier: 0.25,
        scale: 5,
    },
} as const);
const ICON_GAP = `${B.iconScale.scale * B.algo.iconGapMul * B.iconScale.density * B.iconScale.baseUnit}rem`;

// --- [ENTRY_POINT] -----------------------------------------------------------

const controls = createControls({ behavior: B.behavior, scale: B.scale });
const iconControls = createControls({ behavior: B.behavior, scale: B.iconScale });
const data = createData({ behavior: B.behavior, scale: B.scale });
const elements = createElements({ behavior: B.behavior, scale: B.scale });
const feedback = createFeedback({ animation: B.animation, feedback: B.feedback, scale: B.scale });
const icons = createIcons({ scale: B.scale });
const inputBars = createInputBars({ behavior: B.behavior, scale: { ...B.scale, scale: 4 } });
const navigation = createNavigation({ animation: B.animation, behavior: B.behavior, scale: B.scale });
const overlays = createOverlays({ animation: B.animation, scale: B.scale });
const selection = createSelection({ animation: B.animation, behavior: B.behavior, scale: B.scale });
const upload = createUpload({ scale: B.scale });
const utility = createUtility({ scale: B.scale });

// --- [EXPORT] ----------------------------------------------------------------

const { Button, Input } = controls;
const { Button: IconButton } = iconControls;
const { Avatar, ListItem, Thumb } = data;
const { Stack, Flex, Box } = elements;
const { Empty, Spinner } = feedback;
const { Icon } = icons;
const { Bar: InputBar } = inputBars;
const { Stepper } = navigation;
const { Dialog, Modal } = overlays;
const { ContextSelector, Select } = selection;
const { Trigger: UploadTrigger, Zone: UploadZone } = upload;
const { GridOverlay, SafeAreaOverlay, ScrollArea, SvgPreview } = utility;

export {
    Avatar,
    Box,
    Button,
    ContextSelector,
    Dialog,
    Empty,
    Flex,
    GridOverlay,
    Icon,
    IconButton,
    ICON_GAP,
    Input,
    InputBar,
    ListItem,
    Modal,
    SafeAreaOverlay,
    ScrollArea,
    Select,
    Spinner,
    Stack,
    Stepper,
    SvgPreview,
    Thumb,
    UploadTrigger,
    UploadZone,
};
