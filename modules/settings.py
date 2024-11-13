
def show_settings():
    st.title("Settings")
    st.write("Configure your application settings here.")

    # Model selection option
    model_options = [
        "meta-llama/CodeLlama-7b-Python-hf",
        "meta-llama/CodeLlama-13b-Python-hf",
        "meta-llama/CodeLlama-30b-Python-hf"
    ]
    selected_model = st.selectbox("Select Model for Code Generation", model_options)

    # Save selected model in session state for later use
    if "selected_model" not in st.session_state:
        st.session_state.selected_model = selected_model

    # Update model if selection changes
    if st.session_state.selected_model != selected_model:
        st.session_state.selected_model = selected_model
        st.success(f"Model selected: {selected_model}")

    # Display currently selected model
    st.write(f"Current model selection: {st.session_state.selected_model}")
