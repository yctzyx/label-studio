import { type FC, forwardRef, type ForwardedRef, useImperativeHandle, useRef } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import InfiniteLoader from "react-window-infinite-loader";
import { VariableSizeList } from "react-window";
import clsx from "clsx";

export interface AutoSizerTableProps {
  totalCount: number;
  loadMore: (startIndex: number, stopIndex: number) => Promise<void>;
  isItemLoaded: (index: number) => boolean;
  itemData: any;
  itemSize: (index: number) => number;
  itemSizeKey?: string | number;
  initialScrollOffset?: (height: number) => number;
  className?: string;
  children: FC<any>;
  heightAdjustment?: number;
}

export const AutoSizerTable = forwardRef<VariableSizeList, AutoSizerTableProps>(
  (
    {
      totalCount,
      loadMore,
      isItemLoaded,
      itemData,
      itemSize,
      itemSizeKey,
      initialScrollOffset,
      className,
      children: ItemWrapper,
      heightAdjustment = 0,
      ...rest
    },
    ref: ForwardedRef<VariableSizeList>,
  ) => {
    const listRef = useRef<VariableSizeList | null>(null);
    const {
      itemCount: explicitItemCount,
      ...variableSizeListRest
    } = rest as typeof rest & { itemCount?: number };

    /** Must match VariableSizeList.itemCount (e.g. tasks + sticky header row). */
    const virtualRowCount = explicitItemCount ?? totalCount;

    useImperativeHandle(ref, () => listRef.current as VariableSizeList);

    return (
      <AutoSizer className={clsx(className)} style={{ width: "100%", height: "100%", minHeight: 0 }}>
        {({ width, height }) => {
          const adjustedHeight = Math.max(0, height - heightAdjustment);

          return (
            <InfiniteLoader
              itemCount={virtualRowCount}
              loadMoreItems={loadMore}
              isItemLoaded={isItemLoaded}
              threshold={5}
              minimumBatchSize={30}
            >
              {({
                onItemsRendered,
                ref: infiniteLoaderRef,
              }: { onItemsRendered: (params: { startIndex: number; stopIndex: number }) => void; ref: any }) => {
                const setListRef = (instance: VariableSizeList | null) => {
                  listRef.current = instance;

                  if (typeof infiniteLoaderRef === "function") {
                    infiniteLoaderRef(instance);
                  } else if (infiniteLoaderRef) {
                    infiniteLoaderRef.current = instance;
                  }
                };

                return (
                  <VariableSizeList
                    key={itemSizeKey}
                    ref={setListRef}
                    width={width}
                    height={adjustedHeight}
                    itemCount={virtualRowCount}
                    itemData={itemData}
                    itemSize={itemSize}
                    onItemsRendered={onItemsRendered}
                    initialScrollOffset={initialScrollOffset?.(adjustedHeight) ?? 0}
                    {...variableSizeListRest}
                  >
                    {ItemWrapper}
                  </VariableSizeList>
                );
              }}
            </InfiniteLoader>
          );
        }}
      </AutoSizer>
    );
  },
);

AutoSizerTable.displayName = "AutoSizerTable";

export default AutoSizerTable;
