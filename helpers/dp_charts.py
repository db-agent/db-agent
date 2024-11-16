import streamlit as st

def dp_charts():
    if chart_type == "Line Chart":
        st.line_chart(query_result)
    elif chart_type == "Bar Chart":
        st.bar_chart(query_result)
    elif chart_type == "Area Chart":
        st.area_chart(query_result)
    elif chart_type == "Pie Chart":
        # For pie chart, we need to select only one categorical and one numerical column
        if len(query_result.columns) >= 2:
            x_column = st.selectbox("Select a categorical column for the Pie Chart:", query_result.columns)
            y_column = st.selectbox("Select a numerical column for the Pie Chart:", query_result.columns)
            if pd.api.types.is_numeric_dtype(query_result[y_column]):
                pie_chart_data = query_result.groupby(x_column)[y_column].sum().reset_index()
                st.write(pie_chart_data.set_index(x_column).plot.pie(y=y_column, autopct="%1.1f%%", legend=False))
            else:
                st.warning(f"Column '{y_column}' is not numeric. Select a different column for the pie chart.")
        else:
            st.warning("Pie chart requires at least one categorical and one numerical column.")
